// 음봉 단타 규칙 — 순수 함수 (import·DOM·네트워크 없음)
// 매수: 200일선 상승 중 + 음봉(종가 < 시가) → 2칸 (남은 칸이 1이면 1칸), 최대 5칸
// 익절: 종가 ≥ 평단 × 1.05 → 전량 · 손절: 종가 ≤ 평단 × 0.85 → 전량 · 판 날은 사지 않음
// 1칸 = 계좌 금액 ÷ 5 (보유 0일 때 계좌 금액을 다시 정함 = 복리)
// 주식 수: 누적 목표(칸 × 1칸 금액) ÷ 현재가를 반올림, 현금 한도 안에서
// 국내(하이닉스): 15:20 동시호가 예상체결가로 판단 → 그날 종가 체결
// 미국: 아침에 어젯밤 봉으로 판단 → 20:00 주문. 익절은 매일 LOC 매도(평단 × 1.05)를 걸고,
//   매수 LOC 한도는 min(어젯밤 종가 × 1.1, 익절가 − $0.01)이라 같은 밤에 익절과 매수가 같이 체결되지 않음

export const TP = 1.05, SL = 0.85, N = 5;
const FEE = { kr: { buy: 0.00015, sell: 0.00195 }, us: { buy: 0.001, sell: 0.001 } };

const n = v => {
  const x = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,$\s원]/g, ''));
  return Number.isFinite(x) ? x : 0;
};
const r2 = x => Math.round(x * 100) / 100;
const down2 = x => Math.floor(x * 100 + 1e-6) / 100;
const money = (v, us) => us ? '$' + r2(v).toFixed(2) : Math.round(v).toLocaleString('ko-KR') + '원';

export function levels(avg, us = false) {
  const a = n(avg);
  if (!a) return { tp: null, sl: null };
  return us ? { tp: r2(a * TP), sl: r2(a * SL) } : { tp: Math.ceil(a * TP), sl: Math.floor(a * SL) };
}

// 이번 매수 주식 수: 누적 목표 금액에 가장 가까운 보유 수가 되도록, 현금 한도 안에서 (최소 1주)
function buyQty(account, units, qty, avg, price, k) {
  const unit = account / N, cash = account - qty * avg;
  const want = Math.round(unit * (units + k) / price) - qty;
  const cap = Math.floor(cash / price + 1e-9);
  return Math.min(Math.max(1, want), cap);
}

export function decide(p) {
  const us = !!p.us, account = n(p.account), units = Math.round(n(p.units)), qty = n(p.qty), avg = n(p.avg);
  const open = n(p.open), close = n(p.close), maUp = !!p.maUp;
  const none = text => ({ action: 'none', qty: 0, price: null, order: null, text, orders: [] });
  if (!account) return none('계좌 금액을 넣으면 규칙을 계산합니다');
  if (!close || !open) return none(us ? '어젯밤 시가와 종가를 넣으세요' : '오늘 시가와 예상체결가를 넣으세요');

  const held = qty > 0 && avg > 0, { tp, sl } = levels(avg, us);
  const k = Math.min(2, N - units), bear = close < open;
  const canBuy = maUp && bear && k > 0;
  const why = !maUp ? '200일선이 내려가는 중이라 새로 사지 않음' : !bear ? '양봉이라 쉼' : '5칸이 다 차서 더 사지 않음';
  const keep = held ? ` · 익절 ${money(tp, us)} 이상 / 손절 ${money(sl, us)} 이하` : '';

  if (!us) {
    const ord = '동시호가';
    if (held && close >= tp) return { action: 'tp', qty, price: null, order: ord, text: `익절: 15:20 동시호가로 ${qty}주 전량 매도 (익절가 ${money(tp)})`, orders: [{ side: 'sell', kind: 'tp', qty, price: null, order: ord }] };
    if (held && close <= sl) return { action: 'sl', qty, price: null, order: ord, text: `손절: 15:20 동시호가로 ${qty}주 전량 매도 (손절가 ${money(sl)})`, orders: [{ side: 'sell', kind: 'sl', qty, price: null, order: ord }] };
    if (canBuy) {
      const q = buyQty(account, units, qty, avg, close, k);
      if (q < 1) return none(`음봉이지만 현금이 모자라 살 수 없음${keep}`);
      return { action: 'buy', qty: q, price: null, order: ord, units: k, text: `음봉: 15:20 동시호가로 ${q}주 매수 (${k}칸 → ${units + k}/${N}칸)`, orders: [{ side: 'buy', kind: 'buy', qty: q, price: null, order: ord, units: k }] };
    }
    return none(`할 일 없음 · ${why}${keep}`);
  }

  // 미국: close/open = 어젯밤 봉
  if (held && close <= sl) {
    return { action: 'sl', qty, price: null, order: 'MOC', text: `손절: 20:00에 ${qty}주 전량 MOC 매도 (어젯밤 종가가 손절가 ${money(sl, true)} 이하)`, orders: [{ side: 'sell', kind: 'sl', qty, price: null, order: 'MOC' }] };
  }
  const orders = [];
  if (held) orders.push({ side: 'sell', kind: 'tp', qty, price: tp, order: 'LOC' });
  if (canBuy) {
    const limit = held ? Math.min(down2(close * 1.1), r2(tp - 0.01)) : down2(close * 1.1);
    const q = buyQty(account, units, qty, avg, close, k);
    if (q >= 1) orders.push({ side: 'buy', kind: 'buy', qty: q, price: limit, order: 'LOC', units: k });
  }
  if (!orders.length) return none(`할 일 없음 · ${canBuy ? '현금이 모자라 살 수 없음' : why}`);
  const line = o => o.side === 'sell' ? `${o.qty}주 LOC 매도 ${money(o.price, true)}` : `${o.qty}주 LOC 매수 ${money(o.price, true)}까지 (${o.units}칸 → ${units + o.units}/${N}칸)`;
  const first = orders.find(o => o.side === 'buy') || orders[0];
  return {
    action: first.kind, qty: first.qty, price: first.price, order: 'LOC', units: first.units,
    text: `20:00 주문: ${orders.map(line).join(' + ')}${held && !canBuy ? ` · ${why}` : ''}`,
    orders,
  };
}

// "체결했어요" → 저장할 값. order: decide().orders 중 체결된 것 (decision을 넘기면 첫 주문)
export function applyFill(p, order, fillPrice) {
  const o = order?.orders ? order.orders[0] : order;
  const us = !!p.us, fee = FEE[us ? 'us' : 'kr'];
  const account = n(p.account), units = Math.round(n(p.units)), qty = n(p.qty), avg = n(p.avg), px = n(fillPrice);
  const keep = { qty, avg, units, account };
  if (!o || !px) return keep;
  if (o.side === 'buy') {
    const q = n(o.qty), nq = qty + q, na = (qty * avg + q * px) / nq;
    return { qty: nq, avg: us ? Math.round(na * 10000) / 10000 : Math.round(na), units: Math.min(N, units + (o.units ?? Math.min(2, N - units))), account };
  }
  // 전량 매도: 계좌 금액 = 남은 현금 + 판 돈 (수수료·세금 뺌) → 다음 1칸이 커지거나 작아짐
  const cash = account - qty * avg * (1 + fee.buy), got = qty * px * (1 - fee.sell);
  const next = cash + got;
  return { qty: 0, avg: 0, units: 0, account: us ? r2(next) : Math.round(next) };
}
