export interface InlineButton {
  text: string;
  callbackData?: string;
  url?: string;
}

export interface WhatsAppTemplateOptions {
  name: string;
  language: string;
  parameters?: string[];
}

export interface SendMessageOptions {
  replyMarkup?: {
    inlineKeyboard?: InlineButton[][];
  };
  isInside24hWindow?: boolean; // For WhatsApp 24h customer service session window
  template?: WhatsAppTemplateOptions;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string | number;
  permanentFailure?: boolean; // e.g. 403 Forbidden, 400 invalid recipient/unregistered WhatsApp number
  error?: string;
}

export interface InboundUpdate {
  updateId: number | string; // Telegram uses integer update_id; WhatsApp uses string wamid
  externalId: string; // e.g. Telegram chat_id or WhatsApp E.164 phone number
  text?: string;
  callbackData?: string;
  messageId?: number | string;
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

