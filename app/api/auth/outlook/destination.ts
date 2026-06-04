export function outlookConnectedRedirectPath(channelAccountId: string): string {
  const params = new URLSearchParams({
    outlook: "connecting",
    channel_account_id: channelAccountId,
  });
  return `/dashboard/deliverability?${params.toString()}`;
}
