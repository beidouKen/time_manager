import { TodoList } from "@/components/todo/TodoList";

export function TodoPage() {
  return (
    <div className="flex h-full overflow-hidden bg-white">
      <div className="flex-1 overflow-hidden flex flex-col">
        <TodoList />
      </div>
    </div>
  );
}
