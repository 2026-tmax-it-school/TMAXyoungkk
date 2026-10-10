import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GpsSample } from '../src/types';
import { BG_FAIL_LINE, BG_LINE, bgRecordEndsAt, type BgFailReason, type BgRecordBlock } from '../src/core/live/background';
import type { LiveMode } from '../src/core/live/mode';
import { createWatchControl } from '../src/core/live/watchControl';
import { atKst } from '../src/core/util';

/**
 * 위치 받기 제어(WP5, core/live/watchControl). 스토어(store/live)가 진행마다 하나 만들어 쓰는 켜고 끄기 규칙을
 * 가짜 어댑터·시계·타이머로 동작으로 확인한다. 앱 안 감시와 백그라운드 받기를 언제 켜고 끄는지, 실패하면 옵션을 끄게 하고
 * 되풀이하지 않는지, 진행 날짜가 끝나면 멈추는지, 진행을 끝내면 모두 멈추는지.
 */

const DATE = '2026-10-18';
const at = (hhmm: string) => atKst(DATE, hhmm);

interface FakeWatch {
  stopped: boolean;
  onSample: (s: GpsSample) => void;
  onFail?: (reason: BgFailReason) => void;
}

function harness(o: {
  now?: number;
  pref?: boolean;
  mode?: LiveMode;
  block?: BgRecordBlock;
  stillSilent?: boolean;
  /** 스토어가 실패 때 옵션을 끄는지(끄지 못하는 스토어도 되풀이하지 않는지 본다) */
  storeTurnsOff?: boolean;
  /** 받기를 켜자마자 실패하는 어댑터 */
  failOnStart?: BgFailReason;
} = {}) {
  let now = o.now ?? at('10:00');
  const state = { pref: o.pref ?? true, mode: o.mode ?? ('device' as LiveMode), inBackground: false };
  const bgWatches: FakeWatch[] = [];
  const fgWatches: FakeWatch[] = [];
  const events: string[] = [];
  const timers = new Map<number, { fn: () => void; at: number }>();
  let nextTimer = 1;
  let fgProvider = 'device';
  const control = createWatchControl({
    date: DATE,
    intervalMs: 30_000,
    bg: {
      block: () => o.block,
      stillSilent: o.stillSilent ?? true,
      watch: (onSample, opts) => {
        const w: FakeWatch = { stopped: false, onSample, onFail: opts.onFail };
        bgWatches.push(w);
        if (o.failOnStart) opts.onFail(o.failOnStart);
        return () => {
          w.stopped = true;
        };
      },
    },
    fg: () => ({
      watch: (onSample) => {
        const w: FakeWatch = { stopped: false, onSample };
        fgWatches.push(w);
        events.push(`fg:${fgProvider}`);
        return () => {
          w.stopped = true;
        };
      },
    }),
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
    read: () => state,
    onSample: (s) => events.push(`sample:${s.t}`),
    onRecording: (on, _at, silent) => events.push(`rec:${on}:${silent}`),
    onFail: (reason) => {
      events.push(`fail:${reason}`);
      if (o.storeTurnsOff !== false) state.pref = false;
    },
    onLine: (text) => events.push(`line:${text}`),
  });
  return {
    control,
    state,
    bgWatches,
    fgWatches,
    events,
    timers,
    setProvider: (id: string) => {
      fgProvider = id;
    },
    /** 시계를 옮기고 그때까지 걸린 타이머를 돌린다 */
    advance: (to: number) => {
      now = to;
      for (const [id, t] of [...timers]) {
        if (t.at <= to) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    setNow: (t: number) => {
      now = t;
    },
  };
}

const live = (ws: FakeWatch[]) => ws.filter((w) => !w.stopped).length;

test('sync는 앱 안 감시와 백그라운드 받기를 한 번씩 켜고, 실제로 켤 때만 기록 상태와 켜짐 줄을 낸다(다시 불러도 그대로)', () => {
  const h = harness();
  h.control.sync();
  h.control.sync();
  assert.equal(h.bgWatches.length, 1);
  assert.equal(h.fgWatches.length, 1);
  assert.equal(h.control.bgActive(), true);
  assert.deepEqual(h.events, ['rec:true:true', `line:${BG_LINE.on}`, 'fg:device']);
  // 진행 날짜가 끝나는 시각(다음 날 0시) 뒤에 다시 맞추는 타이머 하나
  assert.deepEqual([...h.timers.values()].map((t) => t.at), [bgRecordEndsAt(DATE) + 1000]);
  // 받은 샘플은 스토어로 그대로 간다
  h.bgWatches[0].onSample({ t: 1, coord: { latitude: 0, longitude: 0 }, accuracyM: 5 });
  assert.equal(h.events.at(-1), 'sample:1');
});

test('안드로이드 받기는 멈춰 있어도 샘플이 오므로 기록 상태에 그 방식을 넘긴다(엔진이 오래된 샘플을 믿지 않게)', () => {
  const h = harness({ stillSilent: false });
  h.control.sync();
  assert.equal(h.events[0], 'rec:true:false');
});

test('화면 밖으로 가면 앱 안 감시만 멈추고 백그라운드 받기는 남는다. 돌아오면 앱 안 감시를 다시 켠다', () => {
  const h = harness();
  h.control.sync();
  h.state.inBackground = true;
  h.control.sync();
  assert.equal(live(h.fgWatches), 0);
  assert.equal(live(h.bgWatches), 1);
  h.state.inBackground = false;
  h.control.sync();
  assert.equal(h.fgWatches.length, 2);
  assert.equal(live(h.fgWatches), 1);
  assert.equal(h.bgWatches.length, 1, '백그라운드 받기는 다시 켜지 않는다');
  // 옵션이 꺼진 채 화면 밖에 있던 진행은 돌아오기 전에는 백그라운드 받기를 새로 켜지 않는다(안드로이드 12+)
  const off = harness({ pref: false });
  off.control.sync();
  off.state.inBackground = true;
  off.state.pref = true;
  off.control.sync();
  assert.equal(off.bgWatches.length, 0);
  off.state.inBackground = false;
  off.control.sync();
  assert.equal(off.bgWatches.length, 1);
});

test('받기가 실패하면 기록을 끄고 옵션을 끄게 알리고 이유를 남긴다. 스토어가 옵션을 끄지 못해도 다시 켜며 되풀이하지 않는다', () => {
  const h = harness({ storeTurnsOff: false });
  h.control.sync();
  h.bgWatches[0].onFail?.('denied');
  assert.deepEqual(h.events.slice(3), ['rec:false:true', 'fail:denied', `line:${BG_FAIL_LINE.denied}`]);
  assert.equal(h.control.bgActive(), false);
  assert.equal(h.timers.size, 0, '자정 타이머도 푼다');
  for (let i = 0; i < 3; i += 1) h.control.sync();
  assert.equal(h.bgWatches.length, 1, '옵션이 켜진 채여도 이 진행에서는 다시 켜지 않는다');
  assert.equal(live(h.fgWatches), 1, '앱 안 감시는 그대로 돈다');
  // 같은 받기가 또 실패를 넘겨도 한 번만 처리한다
  h.bgWatches[0].onFail?.('failed');
  assert.equal(h.events.filter((e) => e.startsWith('fail:')).length, 1);
  // 사용자가 끄고(옵션 꺼짐을 본 뒤) 다시 켜면 다시 켠다
  h.state.pref = false;
  h.control.sync();
  h.state.pref = true;
  h.control.sync();
  assert.equal(h.bgWatches.length, 2);
});

test('스토어가 옵션을 끄면 실패 뒤 그 자리에서 앱 안 감시로만 돈다', () => {
  const h = harness();
  h.control.sync();
  h.bgWatches[0].onFail?.('notInBuild');
  assert.equal(h.state.pref, false);
  assert.ok(h.events.includes(`line:${BG_FAIL_LINE.notInBuild}`));
  assert.equal(h.bgWatches.length, 1);
  assert.equal(live(h.fgWatches), 1);
});

test('켜자마자 실패하면 켜짐·실패 줄을 남기고 타이머를 걸지 않는다', () => {
  const h = harness({ failOnStart: 'servicesOff' });
  h.control.sync();
  assert.deepEqual(h.events.slice(0, 4), ['rec:true:true', `line:${BG_LINE.on}`, 'rec:false:true', 'fail:servicesOff']);
  assert.equal(h.timers.size, 0);
  assert.equal(h.control.bgActive(), false);
  assert.equal(h.bgWatches.length, 1);
});

test('진행 날짜가 끝나면 샘플이 없어도 타이머가 백그라운드 받기를 멈추고 날짜 지남 줄을 남긴다. 앱 안 감시는 그대로다', () => {
  const h = harness({ now: at('23:50') });
  h.control.sync();
  h.advance(bgRecordEndsAt(DATE) + 1000);
  assert.equal(h.bgWatches[0].stopped, true);
  assert.equal(h.control.bgActive(), false);
  assert.deepEqual(h.events.slice(-2), ['rec:false:true', `line:${BG_LINE.dateOver}`]);
  assert.equal(live(h.fgWatches), 1);
  h.control.sync();
  assert.equal(h.bgWatches.length, 1, '다음 날에는 다시 켜지 않는다');
});

test('진행 날짜 전날 밤에 시작하면 그날이 될 때 켠다(시계 틱이 sync를 부른다)', () => {
  const h = harness({ now: atKst('2026-10-17', '23:58') });
  h.control.sync();
  assert.equal(h.bgWatches.length, 0);
  h.setNow(at('00:00'));
  h.control.sync();
  assert.equal(h.bgWatches.length, 1);
});

test('옵션을 끄면 백그라운드 받기를 멈추고 끔 줄을 남긴다. 돌고 있지 않았으면 줄을 남기지 않는다', () => {
  const h = harness();
  h.control.sync();
  h.state.pref = false;
  h.control.sync();
  assert.equal(h.bgWatches[0].stopped, true);
  assert.deepEqual(h.events.slice(-2), ['rec:false:true', `line:${BG_LINE.off}`]);
  assert.equal(h.timers.size, 0);
  const idle = harness({ pref: false });
  idle.control.sync();
  idle.control.sync();
  assert.deepEqual(idle.events, ['fg:device']);
});

test('시뮬레이터·수동·켤 수 없는 환경에서는 백그라운드 받기를 켜지 않는다(시뮬레이터는 앱 안 감시만)', () => {
  for (const [mode, fg] of [
    ['sim', 1],
    ['manual', 0],
    ['off', 0],
  ] as const) {
    const h = harness({ mode });
    h.control.sync();
    assert.equal(h.bgWatches.length, 0, mode);
    assert.equal(h.fgWatches.length, fg, mode);
  }
  const go = harness({ block: 'expoGo' });
  go.control.sync();
  assert.equal(go.bgWatches.length, 0);
  assert.equal(go.fgWatches.length, 1);
});

test('restartFg는 앱 안 감시를 새 제공자로 다시 구독한다(시뮬레이터 궤적이 바뀜). 화면 밖이면 돌아올 때 켠다', () => {
  const h = harness({ mode: 'sim' });
  h.control.sync();
  h.setProvider('sim-2');
  h.control.restartFg();
  assert.equal(h.fgWatches[0].stopped, true);
  assert.deepEqual(h.events, ['fg:device', 'fg:sim-2']);
  h.state.inBackground = true;
  h.control.restartFg();
  assert.equal(live(h.fgWatches), 0);
});

test('dispose(진행 끝·리셋·다시 시작)는 모든 받기와 타이머를 멈추고, 그 뒤 늦게 온 실패와 sync는 받지 않는다', () => {
  const h = harness();
  h.control.sync();
  h.control.dispose();
  assert.equal(live(h.bgWatches), 0);
  assert.equal(live(h.fgWatches), 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.control.bgActive(), false);
  assert.equal(h.events.at(-1), 'rec:false:true', '화면의 bgActive도 꺼진다');
  const n = h.events.length;
  h.bgWatches[0].onFail?.('denied');
  h.control.sync();
  h.control.dispose();
  assert.equal(h.events.length, n);
  assert.equal(h.bgWatches.length, 1);
  assert.equal(h.state.pref, true, '진행을 끝낸 뒤 온 실패로 옵션을 끄지 않는다');
});
