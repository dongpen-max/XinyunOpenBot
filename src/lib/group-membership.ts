function uniqueMemberIds(memberIds: readonly string[]): string[] {
  return [...new Set(memberIds)];
}

export function addGroupMember(memberIds: readonly string[], botId: string): string[] {
  const current = uniqueMemberIds(memberIds);
  return current.includes(botId) ? current : [...current, botId];
}

export function canRemoveGroupMember(memberIds: readonly string[], botId: string): boolean {
  const current = uniqueMemberIds(memberIds);
  return current.includes(botId) && current.length > 1;
}

export function removeGroupMember(memberIds: readonly string[], botId: string): string[] {
  const current = uniqueMemberIds(memberIds);
  return canRemoveGroupMember(current, botId) ? current.filter((id) => id !== botId) : current;
}
