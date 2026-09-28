/**
 * SMS sender — placeholder for the partner/BYO provider model.
 *
 * The interface and config slot exist so phone verification is feature-ready:
 * customers will bring their own provider credentials (Twilio, Vonage, …) or
 * purchase SMS through us once a partner integration lands. Until a provider
 * is wired, every send throws SmsNotConfiguredError and the phone
 * verification endpoints respond 501 SMS_NOT_CONFIGURED.
 */

export interface SmsSender {
  readonly provider: string;
  send(params: { to: string; body: string }): Promise<void>;
}

class NoopSmsProvider implements SmsSender {
  readonly provider = "none";
  async send(_params: { to: string; body: string }): Promise<void> {
    throw new SmsNotConfiguredError();
  }
}

export class SmsNotConfiguredError extends Error {
  constructor() { super("No SMS provider is configured for this organization"); }
}

// Replaced when a real provider integration (BYO credential slot) lands.
let activeSender: SmsSender = new NoopSmsProvider();

export function smsSender(): SmsSender {
  return activeSender;
}

export function isSmsConfigured(): boolean {
  return activeSender.provider !== "none";
}
