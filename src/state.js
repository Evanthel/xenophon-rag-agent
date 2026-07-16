export function createConversationState() {
  return {
    history: [],
    ragHistory: [],
    transcriptTurns: [],
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    costTotal: 0,
    prevPromptTokens: 0,
    prevCompletionTokens: 0,
    prevRagPromptTokens: 0,
    prevRagCompletionTokens: 0,
  };
}

export function resetConversationState(state) {
  state.history.length = 0;
  state.ragHistory.length = 0;
  state.transcriptTurns.length = 0;
  state.tokensIn = 0;
  state.tokensOut = 0;
  state.tokensCached = 0;
  state.costTotal = 0;
  state.prevPromptTokens = 0;
  state.prevCompletionTokens = 0;
  state.prevRagPromptTokens = 0;
  state.prevRagCompletionTokens = 0;
}

export function setOrClear(storageKey, value) {
  if (value) sessionStorage.setItem(storageKey, value);
  else sessionStorage.removeItem(storageKey);
}
