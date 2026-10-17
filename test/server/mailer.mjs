/**
 * 메일 보내기(WP2 소유, 2026-10-17). 인증 메일·비밀번호 재설정 메일을 SMTP로 실제로 보낸다. 외부 패키지 없이 node:tls로 직접 말한다.
 * 서버 변수: SMTP_HOST, SMTP_PORT(기본 465, 처음부터 TLS인 포트만. STARTTLS 587은 지원하지 않는다), SMTP_USER, SMTP_PASS, MAIL_FROM(없으면 SMTP_USER).
 * 모두 있어야 켜진다. 값(특히 SMTP_PASS)은 로그에 남기지 않는다(켜짐·꺼짐과 호스트만).
 * 지키는 것: 받는 사람·보내는 사람·제목에 줄바꿈이 있으면 거절(머리글 끼워 넣기 방지), 전체 12초 마감, 본문은 UTF-8 base64.
 * 보낸 메일은 보낸편지함(개발용)에도 그대로 쌓이니 메일이 안 가도 개발 서버에서는 읽을 수 있다.
 */
import net from 'node:net';
import tls from 'node:tls';

export const MAIL_TIMEOUT_MS = 12_000;
const CRLF = '\r\n';
const NO_BREAK = /[\r\n]/;
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** 환경 변수 → 메일 설정. 빠진 값이 있으면 null(메일 끔) */
export function mailerOptionsFromEnv(env) {
  const host = (env.SMTP_HOST ?? '').trim();
  const user = (env.SMTP_USER ?? '').trim();
  const pass = (env.SMTP_PASS ?? '').replace(/\s+/g, '');
  const from = (env.MAIL_FROM ?? '').trim() || user;
  const port = Number((env.SMTP_PORT ?? '').trim() || 465);
  if (!host || !user || !pass || !from || !Number.isInteger(port) || port <= 0) return null;
  return { host, port, user, pass, from };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/(.{76})/g, `$1${CRLF}`);

/** 한 번 보낸 메일 한 통의 SMTP 대화 본문(DATA 부분) */
export function buildMessage({ from, to, subject, text }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text)),
  ].join(CRLF);
}

/**
 * @param {{host:string, port:number, user:string, pass:string, from:string, secure?:boolean, timeoutMs?:number, log?:(m:string)=>void}} opts
 *   secure:false는 테스트용(처음부터 TLS가 아닌 연결)이다
 */
export function createMailer({ host, port, user, pass, from, secure = true, timeoutMs = MAIL_TIMEOUT_MS, log = () => {} }) {
  /** @returns {Promise<void>} */
  function send({ to, subject, text }) {
    if (![to, subject, from].every((v) => typeof v === 'string' && !NO_BREAK.test(v))) return Promise.reject(new Error('줄바꿈이 든 주소·제목'));
    if (!ADDRESS.test(to) || !ADDRESS.test(from)) return Promise.reject(new Error('메일 주소 모양이 틀림'));
    return new Promise((resolve, reject) => {
      const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
      let buf = '';
      let waiter = null;
      let done = false;
      let quit = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.destroy();
        err ? reject(err) : resolve();
      };
      const timer = setTimeout(() => finish(new Error('SMTP 시간 초과')), timeoutMs);
      socket.setEncoding('utf8');
      socket.on('error', (e) => finish(e));
      // QUIT까지 보낸 뒤의 끊김은 정상이다(메일은 이미 받아들여졌다)
      socket.on('close', () => finish(quit ? undefined : new Error('SMTP 연결이 끊김')));
      socket.on('data', (d) => {
        buf += d;
        // 한 응답은 'NNN ' 줄로 끝난다('NNN-'는 이어지는 줄)
        for (;;) {
          const lines = buf.split(CRLF);
          if (lines.length < 2) return;
          const lastIdx = lines.findIndex((l) => /^\d{3} /.test(l));
          if (lastIdx < 0) return;
          const reply = lines.slice(0, lastIdx + 1);
          buf = lines.slice(lastIdx + 1).join(CRLF);
          const code = Number(reply[lastIdx].slice(0, 3));
          const w = waiter;
          waiter = null;
          if (w) w(code);
        }
      });
      const expect = (ok) => new Promise((res, rej) => { waiter = (code) => (ok.includes(code) ? res(code) : rej(new Error(`SMTP 거절 ${code}`))); });
      const say = (line) => socket.write(line + CRLF);
      (async () => {
        await expect([220]);
        say('EHLO youngtrip.local');
        await expect([250]);
        say('AUTH LOGIN');
        await expect([334]);
        say(b64(user));
        await expect([334]);
        say(b64(pass));
        await expect([235]);
        say(`MAIL FROM:<${from}>`);
        await expect([250]);
        say(`RCPT TO:<${to}>`);
        await expect([250, 251]);
        say('DATA');
        await expect([354]);
        // 점으로 시작하는 줄은 점을 하나 더 붙인다(SMTP 규칙)
        say(buildMessage({ from, to, subject, text }).replace(/^\./gm, '..') + CRLF + '.');
        await expect([250]);
        quit = true;
        say('QUIT');
        // 서버가 221로 닫는 것까지 기다린다(바로 끊으면 서버 쪽에 연결 재설정이 난다). 안 와도 마감이 끝낸다
        await expect([221]).catch(() => {});
        finish();
      })().catch((e) => finish(e));
    });
  }
  return {
    host,
    /** 보내지 못해도 던지지 않는다(가입·재설정 요청은 그대로 끝난다). 실패는 상태만 한 줄 기록한다 */
    async trySend(mail) {
      try {
        await send(mail);
        return true;
      } catch (e) {
        log(`메일 발송 실패(${host}): ${e?.message ?? e}`);
        return false;
      }
    },
    send,
  };
}
