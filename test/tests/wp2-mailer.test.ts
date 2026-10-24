import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';

import { mailText } from '../server/auth.mjs';
import { createSyncStore, startSyncServer } from '../server/sync-server.mjs';
import { buildMessage, createMailer, mailerOptionsFromEnv } from '../server/mailer.mjs';

/**
 * 메일 보내기(server/mailer.mjs, 2026-10-17). 가짜 SMTP 서버(net)로 대화 순서·로그인·본문 인코딩·거절·시간 초과를 본다.
 * 실제 메일 서버는 부르지 않는다.
 */

type Fake = { port: number; seen: string[]; data: string; close: () => Promise<void> };

/** 대본대로 답하는 가짜 SMTP. rejectAuth면 로그인에 535 */
async function fakeSmtp(opts: { rejectAuth?: boolean; silent?: boolean } = {}): Promise<Fake> {
  const seen: string[] = [];
  const f: Fake = { port: 0, seen, data: '', close: async () => {} };
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    if (opts.silent) return;
    let inData = false;
    let buf = '';
    let authStep = 0;
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (d: string) => {
      buf += d;
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          f.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          sock.write('250 queued\r\n');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        seen.push(authStep > 0 && !/^[A-Z]/.test(line) ? '(auth value)' : line.split(' ')[0] + (line.startsWith('MAIL') || line.startsWith('RCPT') ? ` ${line}` : ''));
        if (line.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') {
          authStep = 1;
          sock.write('334 VXNlcm5hbWU6\r\n');
        } else if (authStep === 1) {
          authStep = 2;
          sock.write('334 UGFzc3dvcmQ6\r\n');
        } else if (authStep === 2) {
          authStep = 0;
          sock.write(opts.rejectAuth ? '535 bad credentials\r\n' : '235 ok\r\n');
        } else if (line.startsWith('MAIL') || line.startsWith('RCPT')) sock.write('250 ok\r\n');
        else if (line === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  f.port = (server.address() as net.AddressInfo).port;
  f.close = () => new Promise((r) => server.close(() => r()));
  return f;
}

const mk = (port: number, over: Record<string, unknown> = {}) =>
  createMailer({ host: '127.0.0.1', port, user: 'me@gmail.com', pass: 'secret-app-pass', from: 'me@gmail.com', secure: false, timeoutMs: 1500, ...over });

test('설정: 다섯 값이 모두 있어야 켜진다, 앱 비밀번호의 띄어쓰기는 뗀다, 포트 기본 465', () => {
  assert.equal(mailerOptionsFromEnv({}), null);
  assert.equal(mailerOptionsFromEnv({ SMTP_HOST: 'h', SMTP_USER: 'u@x.com' }), null);
  const o = mailerOptionsFromEnv({ SMTP_HOST: ' smtp.gmail.com ', SMTP_USER: 'u@x.com', SMTP_PASS: 'abcd efgh ijkl mnop' })!;
  assert.deepEqual(o, { host: 'smtp.gmail.com', port: 465, user: 'u@x.com', pass: 'abcdefghijklmnop', from: 'u@x.com' });
  assert.equal(mailerOptionsFromEnv({ SMTP_HOST: 'h', SMTP_USER: 'u@x.com', SMTP_PASS: 'p', MAIL_FROM: 'a@b.com', SMTP_PORT: '2525' })!.from, 'a@b.com');
  assert.equal(mailerOptionsFromEnv({ SMTP_HOST: 'h', SMTP_USER: 'u@x.com', SMTP_PASS: 'p', SMTP_PORT: 'x' }), null);
});

test('보내기: EHLO → 로그인 → MAIL → RCPT → DATA 순서, 본문은 UTF-8 base64, 제목은 인코딩', async () => {
  const smtp = await fakeSmtp();
  try {
    await mk(smtp.port).send({ to: 'you@example.com', subject: 'Young Trip 이메일 인증', text: mailText('verify', 'TOKEN_abc-123') });
    assert.deepEqual(smtp.seen.filter((s) => !s.startsWith('(auth')), ['EHLO', 'AUTH', 'MAIL MAIL FROM:<me@gmail.com>', 'RCPT RCPT TO:<you@example.com>', 'DATA', 'QUIT']);
    assert.ok(!smtp.seen.join(' ').includes('secret-app-pass'), '비밀번호 원문은 대화에 없다(base64로만 간다)');
    const [head, body] = smtp.data.split('\r\n\r\n');
    assert.match(head, /^From: me@gmail\.com/m);
    assert.match(head, /^To: you@example\.com/m);
    assert.match(head, /Subject: =\?UTF-8\?B\?/);
    const text = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.match(text, /이메일 인증 코드/);
    assert.match(text, /TOKEN_abc-123/);
    assert.match(text, /24시간/);
    assert.match(mailText('reset', 't'), /30분/);
  } finally {
    await smtp.close();
  }
});

test('거절·실패: 로그인 535, 줄바꿈 든 주소·제목, 모양 틀린 주소, 응답 없음 시간 초과. trySend는 던지지 않고 로그만', async () => {
  const bad = await fakeSmtp({ rejectAuth: true });
  const quiet = await fakeSmtp({ silent: true });
  try {
    await assert.rejects(mk(bad.port).send({ to: 'you@example.com', subject: 's', text: 't' }), /535/);
    await assert.rejects(mk(bad.port).send({ to: 'you@example.com\r\nBcc: x@y.com', subject: 's', text: 't' }), /줄바꿈/);
    await assert.rejects(mk(bad.port).send({ to: 'you@example.com', subject: 's\r\nX: y', text: 't' }), /줄바꿈/);
    await assert.rejects(mk(bad.port).send({ to: 'not-an-address', subject: 's', text: 't' }), /모양/);
    await assert.rejects(mk(quiet.port, { timeoutMs: 300 }).send({ to: 'you@example.com', subject: 's', text: 't' }), /시간 초과/);
    const logs: string[] = [];
    assert.equal(await mk(bad.port, { log: (m: string) => logs.push(m) }).trySend({ to: 'you@example.com', subject: 's', text: 't' }), false);
    assert.equal(logs.length, 1);
    assert.ok(!logs[0].includes('secret-app-pass') && !logs[0].includes('you@example.com'), '로그에 비밀번호와 받는 주소를 남기지 않는다');
  } finally {
    await bad.close();
    await quiet.close();
  }
});

test('DATA의 점으로 시작하는 줄은 점을 하나 더 붙인다', () => {
  const m = buildMessage({ from: 'a@b.com', to: 'c@d.com', subject: 's', text: '.점 시작' });
  assert.ok(m.startsWith('From: a@b.com'));
});

test('머리글에 Date와 Message-ID가 있다(받는 쪽 필터가 의심하지 않게)', () => {
  const m = buildMessage({ from: 'a@b.com', to: 'c@d.com', subject: 's', text: 't', now: new Date('2026-10-24T01:02:03Z') });
  assert.match(m, /^Date: Sat, 24 Oct 2026 01:02:03 \+0000$/m);
  assert.match(m, /^Message-ID: <[0-9a-f]{24}@b\.com>$/m);
  const other = buildMessage({ from: 'a@b.com', to: 'c@d.com', subject: 's', text: 't' });
  assert.notEqual(m.match(/^Message-ID: .*$/m)![0], other.match(/^Message-ID: .*$/m)![0]);
});

test('가입 응답: 메일 서버가 실패하면 mailFailed, 성공·늦음·메일 꺼짐이면 없다(가입 자체는 늘 된다)', async () => {
  const run = async (mailer: { trySend: (m: { to: string; subject: string; text: string }) => Promise<boolean> } | undefined, email: string) => {
    const srv = await startSyncServer({
      store: createSyncStore(),
      purgeEveryMs: 0,
      proxy: false,
      auth: { devOutbox: true, passwordCost: 1024, mailWaitMs: 200, ...(mailer ? { mailer } : {}) },
    });
    try {
      const r = await fetch(`${srv.url}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'trip2026ok', nickname: '메일실패' }),
      });
      return (await r.json()) as { ok: boolean; mailFailed?: boolean };
    } finally {
      await srv.close();
    }
  };
  const sent: string[] = [];
  const ok = { trySend: async (m: { to: string; subject: string; text: string }) => (sent.push(m.to), true) };
  const fail = { trySend: async () => false };
  const slow = { trySend: () => new Promise<boolean>(() => {}) };
  const a = await run(fail, 'a@example.com');
  assert.equal(a.ok, true);
  assert.equal(a.mailFailed, true);
  const b = await run(ok, 'b@example.com');
  assert.deepEqual([b.ok, b.mailFailed], [true, undefined]);
  assert.deepEqual(sent, ['b@example.com']);
  const c = await run(slow, 'c@example.com');
  assert.deepEqual([c.ok, c.mailFailed], [true, undefined]);
  const d = await run(undefined, 'd@example.com');
  assert.deepEqual([d.ok, d.mailFailed], [true, undefined]);
});

test('메일 한도 예외(MAIL_LIMIT_EXEMPT): 적힌 주소만 하루 5통·기기 10분 한도를 건너뛰고, 다른 주소는 그대로 막힌다', async () => {
  const { mailExemptFromEnv } = await import('../server/auth.mjs');
  assert.deepEqual(mailExemptFromEnv({}), []);
  assert.deepEqual(mailExemptFromEnv({ MAIL_LIMIT_EXEMPT: ' Me@Gmail.com, bad, b@x.kr ' }), ['me@gmail.com', 'b@x.kr']);
  const srv = await startSyncServer({
    store: createSyncStore(),
    purgeEveryMs: 0,
    proxy: false,
    auth: { devOutbox: true, passwordCost: 1024, mailExempt: ['me@gmail.com'] },
  });
  try {
    const reset = async (email: string) => {
      const r = await fetch(`${srv.url}/auth/password/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
      return r.status;
    };
    // 예외 주소: 한도(주소 5통·기기 10통)를 훌쩍 넘겨도 계속 200
    const mine: number[] = [];
    for (let i = 0; i < 14; i += 1) mine.push(await reset('me@gmail.com'));
    assert.deepEqual([...new Set(mine)], [200]);
    // 다른 주소: 주소별 하루 5통을 넘으면 429
    const other: number[] = [];
    for (let i = 0; i < 7; i += 1) other.push(await reset('someone@gmail.com'));
    assert.equal(other.slice(0, 5).every((s) => s === 200), true);
    assert.equal(other[5], 429);
  } finally {
    await srv.close();
  }
});
