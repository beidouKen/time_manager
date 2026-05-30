use std::{
    io::{self, Read},
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(serde::Serialize)]
struct CliCommandOutput {
    command: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

fn opencli_command_name() -> &'static str {
    if cfg!(windows) {
        "opencli.cmd"
    } else {
        "opencli"
    }
}

fn wx_command_name() -> &'static str {
    if cfg!(windows) {
        "wx.cmd"
    } else {
        "wx"
    }
}

fn wecom_command_name() -> &'static str {
    if cfg!(windows) {
        "wecom-cli.cmd"
    } else {
        "wecom-cli"
    }
}

fn read_stream<R>(mut stream: R) -> thread::JoinHandle<String>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stream.read_to_string(&mut buffer);
        buffer
    })
}

fn run_cli_command(
    executable: &str,
    display_name: &str,
    args: &[String],
    timeout: Duration,
    working_dir: Option<PathBuf>,
) -> Result<CliCommandOutput, String> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(working_dir) = working_dir {
        command.current_dir(working_dir);
    }

    let mut child = command
        .spawn()
        .map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => format!("未找到 {display_name} 命令，请先安装并初始化。"),
            _ => format!("启动 {display_name} 失败: {error}"),
        })?;

    let stdout_reader = child
        .stdout
        .take()
        .map(read_stream)
        .ok_or_else(|| format!("无法读取 {display_name} stdout。"))?;
    let stderr_reader = child
        .stderr
        .take()
        .map(read_stream)
        .ok_or_else(|| format!("无法读取 {display_name} stderr。"))?;

    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = stdout_reader
                    .join()
                    .map_err(|_| format!("读取 {display_name} stdout 失败。"))?;
                let stderr = stderr_reader
                    .join()
                    .map_err(|_| format!("读取 {display_name} stderr 失败。"))?;
                return Ok(CliCommandOutput {
                    command: format!("{display_name} {}", args.join(" ")),
                    stdout,
                    stderr,
                    exit_code: status.code(),
                });
            }
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    // Do not join stdout/stderr reader threads after timeout.
                    // Some CLI tools spawn daemon children that inherit pipe handles,
                    // so joining here can block the Tauri command indefinitely.
                    drop(stdout_reader);
                    drop(stderr_reader);
                    return Err(format!("{display_name} 执行超时，已终止当前命令。"));
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(format!("等待 {display_name} 失败: {error}")),
        }
    }
}

fn run_opencli_command(args: &[String]) -> Result<CliCommandOutput, String> {
    run_cli_command(
        opencli_command_name(),
        "opencli",
        args,
        Duration::from_secs(60),
        None,
    )
}

fn wx_config_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".wx-cli"))
}

fn run_wx_command(args: &[String]) -> Result<CliCommandOutput, String> {
    run_cli_command(wx_command_name(), "wx", args, Duration::from_secs(10), wx_config_dir())
}

fn run_wecom_command(args: &[String]) -> Result<CliCommandOutput, String> {
    run_cli_command(wecom_command_name(), "wecom-cli", args, Duration::from_secs(20), None)
}

fn is_safe_cli_token(value: &str) -> bool {
    !value.trim().is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn ensure_readonly_wecom_method(method: &str) -> Result<(), String> {
    let lowered = method.to_ascii_lowercase();
    let mutating_words = [
        "send", "post", "create", "update", "delete", "remove", "revoke", "mark", "set",
        "invite", "kick", "upload",
    ];
    if mutating_words.iter().any(|word| lowered.contains(word)) {
        return Err(format!(
            "当前演示入口只允许查询类 wecom-cli 方法，已拒绝：{method}"
        ));
    }
    Ok(())
}

fn clamp_limit(limit: Option<u32>, default_value: u32, max_value: u32) -> String {
    limit.unwrap_or(default_value).clamp(1, max_value).to_string()
}

fn append_date_arg(args: &mut Vec<String>, name: &str, value: Option<String>) {
    if let Some(value) = value {
        if !value.trim().is_empty() {
            args.push(name.to_string());
            args.push(value);
        }
    }
}

fn append_message_type_arg(args: &mut Vec<String>, message_type: Option<String>) -> Result<(), String> {
    let Some(message_type) = message_type else {
        return Ok(());
    };
    if message_type.trim().is_empty() {
        return Ok(());
    }
    let allowed = [
        "text", "image", "voice", "video", "sticker", "location", "link", "file", "call",
        "system",
    ];
    if !allowed.contains(&message_type.as_str()) {
        return Err(format!("不支持的消息类型：{message_type}"));
    }
    args.push("--type".to_string());
    args.push(message_type);
    Ok(())
}

#[tauri::command]
fn opencli_extract_page(url: String) -> Result<CliCommandOutput, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("仅支持 http/https 链接。".to_string());
    }

    let args = vec![
        "web".to_string(),
        "read".to_string(),
        "--url".to_string(),
        url,
        "--stdout".to_string(),
        "true".to_string(),
        "--download-images".to_string(),
        "false".to_string(),
        "--wait".to_string(),
        "1".to_string(),
        "--frames".to_string(),
        "none".to_string(),
    ];
    let output = run_opencli_command(&args)?;
    if output.exit_code.unwrap_or(1) != 0 {
        return Err(format!(
            "opencli 执行失败: {}",
            if output.stderr.trim().is_empty() {
                output.stdout.trim()
            } else {
                output.stderr.trim()
            }
        ));
    }
    Ok(output)
}

#[tauri::command]
fn wecom_cli_help() -> Result<CliCommandOutput, String> {
    let args = vec!["--help".to_string()];
    run_wecom_command(&args)
}

#[tauri::command]
fn wecom_cli_call(
    category: String,
    method: String,
    json_args: Option<String>,
) -> Result<CliCommandOutput, String> {
    if !is_safe_cli_token(&category) || !is_safe_cli_token(&method) {
        return Err("wecom-cli category/method 只能包含字母、数字、下划线和短横线。".to_string());
    }
    ensure_readonly_wecom_method(&method)?;

    let json_args = json_args.unwrap_or_else(|| "{}".to_string());
    if json_args.len() > 4000 {
        return Err("wecom-cli 参数过长，当前演示入口限制为 4000 字符。".to_string());
    }
    let parsed_json: serde_json::Value = serde_json::from_str(&json_args)
        .map_err(|error| format!("wecom-cli json_args 不是合法 JSON: {error}"))?;
    if !parsed_json.is_object() {
        return Err("wecom-cli json_args 必须是 JSON object。".to_string());
    }

    let args = vec![category, method, json_args];
    run_wecom_command(&args)
}

#[tauri::command]
fn wx_cli_sessions(limit: Option<u32>) -> Result<CliCommandOutput, String> {
    let args = vec![
        "sessions".to_string(),
        "--json".to_string(),
        "-n".to_string(),
        clamp_limit(limit, 10, 50),
    ];
    run_wx_command(&args)
}

#[tauri::command]
fn wx_cli_init(force: Option<bool>) -> Result<CliCommandOutput, String> {
    if force.unwrap_or(false) {
        return Err("当前测试入口已禁用 wx init --force；未登录微信时强制扫描密钥可能卡住或触发风险。".to_string());
    }
    let args = vec!["init".to_string()];
    run_wx_command(&args)
}

#[tauri::command]
fn wx_cli_daemon_status() -> Result<CliCommandOutput, String> {
    let args = vec!["daemon".to_string(), "status".to_string()];
    run_wx_command(&args)
}

#[tauri::command]
fn wx_cli_daemon_stop() -> Result<CliCommandOutput, String> {
    let args = vec!["daemon".to_string(), "stop".to_string()];
    run_wx_command(&args)
}

#[tauri::command]
fn wx_cli_daemon_logs(lines: Option<u32>) -> Result<CliCommandOutput, String> {
    let args = vec![
        "daemon".to_string(),
        "logs".to_string(),
        "-n".to_string(),
        clamp_limit(lines, 50, 300),
    ];
    run_wx_command(&args)
}

#[tauri::command]
fn wx_cli_history(
    chat: String,
    limit: Option<u32>,
    offset: Option<u32>,
    since: Option<String>,
    until: Option<String>,
    message_type: Option<String>,
) -> Result<CliCommandOutput, String> {
    if chat.trim().is_empty() {
        return Err("请选择或输入微信会话名称。".to_string());
    }

    let mut args = vec![
        "history".to_string(),
        chat,
        "--json".to_string(),
        "-n".to_string(),
        clamp_limit(limit, 20, 100),
        "--offset".to_string(),
        offset.unwrap_or(0).to_string(),
    ];
    append_date_arg(&mut args, "--since", since);
    append_date_arg(&mut args, "--until", until);
    append_message_type_arg(&mut args, message_type)?;
    run_wx_command(&args)
}

#[tauri::command]
fn wx_cli_search(
    keyword: String,
    chat: Option<String>,
    limit: Option<u32>,
    since: Option<String>,
    until: Option<String>,
    message_type: Option<String>,
) -> Result<CliCommandOutput, String> {
    if keyword.trim().is_empty() {
        return Err("搜索关键词不能为空。".to_string());
    }

    let mut args = vec![
        "search".to_string(),
        keyword,
        "--json".to_string(),
        "-n".to_string(),
        clamp_limit(limit, 20, 100),
    ];
    if let Some(chat) = chat {
        if !chat.trim().is_empty() {
            args.push("--in".to_string());
            args.push(chat);
        }
    }
    append_date_arg(&mut args, "--since", since);
    append_date_arg(&mut args, "--until", until);
    append_message_type_arg(&mut args, message_type)?;
    run_wx_command(&args)
}

#[tauri::command]
fn wx_cli_unread(limit: Option<u32>, filter: Option<String>) -> Result<CliCommandOutput, String> {
    let mut args = vec![
        "unread".to_string(),
        "--json".to_string(),
        "-n".to_string(),
        clamp_limit(limit, 10, 50),
    ];
    if let Some(filter) = filter {
        if !filter.trim().is_empty() {
            args.push("--filter".to_string());
            args.push(filter);
        }
    }
    run_wx_command(&args)
}

#[tauri::command]
fn wx_cli_new_messages(limit: Option<u32>) -> Result<CliCommandOutput, String> {
    let args = vec![
        "new-messages".to_string(),
        "--json".to_string(),
        "-n".to_string(),
        clamp_limit(limit, 50, 100),
    ];
    run_wx_command(&args)
}

#[tauri::command]
fn wx_cli_attachments(
    chat: String,
    limit: Option<u32>,
    offset: Option<u32>,
    since: Option<String>,
    until: Option<String>,
) -> Result<CliCommandOutput, String> {
    if chat.trim().is_empty() {
        return Err("请选择或输入微信会话名称。".to_string());
    }

    let mut args = vec![
        "attachments".to_string(),
        chat,
        "--kind".to_string(),
        "image".to_string(),
        "--json".to_string(),
        "-n".to_string(),
        clamp_limit(limit, 10, 50),
        "--offset".to_string(),
        offset.unwrap_or(0).to_string(),
    ];
    append_date_arg(&mut args, "--since", since);
    append_date_arg(&mut args, "--until", until);
    run_wx_command(&args)
}

#[tauri::command]
fn wx_cli_extract_attachment(
    attachment_id: String,
    output: String,
    overwrite: Option<bool>,
) -> Result<CliCommandOutput, String> {
    if attachment_id.trim().is_empty() {
        return Err("attachment_id 不能为空。".to_string());
    }
    if output.trim().is_empty() {
        return Err("导出文件路径不能为空。".to_string());
    }

    let mut args = vec![
        "extract".to_string(),
        attachment_id,
        "--output".to_string(),
        output,
        "--json".to_string(),
    ];
    if overwrite.unwrap_or(false) {
        args.push("--overwrite".to_string());
    }
    run_wx_command(&args)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            opencli_extract_page,
            wecom_cli_help,
            wecom_cli_call,
            wx_cli_init,
            wx_cli_daemon_status,
            wx_cli_daemon_stop,
            wx_cli_daemon_logs,
            wx_cli_sessions,
            wx_cli_history,
            wx_cli_search,
            wx_cli_unread,
            wx_cli_new_messages,
            wx_cli_attachments,
            wx_cli_extract_attachment
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
