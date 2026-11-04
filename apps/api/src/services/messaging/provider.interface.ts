export interface InlineButton {
  text: string;
  callbackData?: string;
  url?: string;
}

export interface SendMessageOptions {
  replyMarkup?: {
    inlineKeyboard?: InlineButton[][];
  };
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string | number;
  permanentFailure?: boolean; // e.g. 403 Forbidden (bot blocked by user, user deactivated)
  error?: string;
}

export interface InboundUpdate {
  updateId: number;
  externalId: string; // e.g. Telegram chat_id as string
  text?: string;
  callbackData?: string;
  messageId?: number;
  fromName?: string;
}

export interface MessagingProvider {
  readonly name: string;
  send(
    externalId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult>;
  parseInbound(body: unknown): InboundUpdate | null;
  verifyInbound(req: {
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
  }): boolean;
  setWebhook?(url: string, secretToken: string): Promise<boolean>;
}
