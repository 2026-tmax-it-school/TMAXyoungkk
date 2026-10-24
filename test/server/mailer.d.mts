export const MAIL_TIMEOUT_MS: number;
export function mailerOptionsFromEnv(env: Record<string, string | undefined>): { host: string; port: number; user: string; pass: string; from: string } | null;
export function buildMessage(m: { from: string; to: string; subject: string; text: string; now?: Date }): string;
export interface Mailer {
  readonly host: string;
  trySend(mail: { to: string; subject: string; text: string }): Promise<boolean>;
  send(mail: { to: string; subject: string; text: string }): Promise<void>;
}
export function createMailer(opts: { host: string; port: number; user: string; pass: string; from: string; secure?: boolean; timeoutMs?: number; log?: (m: string) => void }): Mailer;
