import { ResponseKinds, type ResponseKind } from "@/agent/schemas";
import { ActionSuccessRenderer } from "./ActionSuccessRenderer";
import { BlockedRenderer } from "./BlockedRenderer";
import { ClarificationRenderer } from "./ClarificationRenderer";
import { ConfirmationRenderer } from "./ConfirmationRenderer";
import { ErrorRenderer } from "./ErrorRenderer";
import { QueryResponseRenderer } from "./QueryResponseRenderer";
import { RecentActionRenderer } from "./RecentActionRenderer";
import { SuggestionRenderer } from "./SuggestionRenderer";
import type { RendererInput, RendererOutput, ResponseRenderer } from "./types";

const RENDERERS: Record<ResponseKind, ResponseRenderer> = {
  [ResponseKinds.QUERY_RESULT]: new QueryResponseRenderer(),
  [ResponseKinds.ACTION_SUCCESS]: new ActionSuccessRenderer(),
  [ResponseKinds.CLARIFICATION]: new ClarificationRenderer(),
  [ResponseKinds.CONFIRMATION]: new ConfirmationRenderer(),
  [ResponseKinds.RECENT_ACTION]: new RecentActionRenderer(),
  [ResponseKinds.BLOCKED]: new BlockedRenderer(),
  [ResponseKinds.ERROR]: new ErrorRenderer(),
  [ResponseKinds.SUGGESTION]: new SuggestionRenderer(),
};

export function renderResponse(
  kind: ResponseKind,
  input: RendererInput
): RendererOutput {
  return RENDERERS[kind].render(input);
}
