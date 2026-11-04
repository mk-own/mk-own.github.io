// 각 목록(컬렉션)의 입력 항목과 표 컬럼 정의.
// field: { k, l(라벨), type?: text|textarea|select|date|number|money|url|check|folder, opts?, req?, due? }
//   due: 날짜 필드를 홈의 "다가오는 일정"에 표시할 때 붙는 이름
// cols: 표에 보일 컬럼. 문자열은 field 키, 객체는 계산 컬럼 { k, l, type, fn }
// cur: 행마다 금액 단위 ('$'면 달러, 없으면 원)
// value: 자산 합계에 더할 금액, debt: 부채 합계에 더할 금액, monthly: 월 지출

import { levels } from './swing.js';

export const num = v => {
  if (v === '' || v == null) return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// 해외 종목: 구분이 해외이거나 종목코드가 영문 티커 (QQQ, SOXL …)
export const isUS = r => r.market === '해외' || /^[A-Za-z][A-Za-z.]*$/.test(r.code || '');
const fxOf = r => (isUS(r) ? num(r.fx) || 1 : 1);

const memo = { k: 'memo', l: '메모', type: 'textarea' };
const person = { k: 'person', l: '대상' };

export const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

export function whenText(r) {
  const days = Array.isArray(r.days) ? DAYS.filter(d => r.days.includes(d)).join('·') : '';
  const time = r.t1 ? `${r.t1}${r.t2 ? `~${r.t2}` : ''}` : '';
  return [days, time].filter(Boolean).join(' ') || r.schedule || '';
}

export const COLLECTIONS = {
  insurance: {
    title: '보험',
    fields: [
      { k: 'company', l: '보험사', req: true },
      { k: 'product', l: '상품명' },
      { k: 'kind', l: '종류', type: 'select', opts: ['종신', '정기', '실손', '암', '건강', '어린이', '연금', '저축', '운전자', '자동차', '화재', '여행', '기타'] },
      { k: 'holder', l: '계약자' },
      { k: 'insured', l: '피보험자' },
      { k: 'premium', l: '월 보험료', type: 'money' },
      { k: 'start', l: '계약일', type: 'date' },
      { k: 'payEnd', l: '납입만기', type: 'date', due: '보험 납입만기' },
      { k: 'end', l: '보장만기', type: 'date', due: '보험 보장만기' },
      { k: 'surrender', l: '해지환급금', type: 'money' },
      { k: 'coverage', l: '주요 보장', type: 'textarea' },
      { k: 'contact', l: '담당자/연락처' },
      memo,
    ],
    cols: ['company', 'product', 'kind', 'insured', 'premium', 'payEnd', 'end'],
    value: r => num(r.surrender),
    monthly: r => num(r.premium),
    label: r => [r.company, r.product].filter(Boolean).join(' '),
  },
  stocks: {
    title: '주식',
    fields: [
      { k: 'broker', l: '증권사/계좌' },
      { k: 'name', l: '종목명', req: true },
      { k: 'code', l: '종목코드' },
      { k: 'market', l: '구분', type: 'select', opts: ['국내', '해외', 'ETF', '기타'] },
      { k: 'qty', l: '수량', type: 'number' },
      { k: 'avg', l: '평균단가', type: 'money' },
      { k: 'price', l: '현재가', type: 'money' },
      { k: 'asOf', l: '현재가 기준일', type: 'date' },
      { k: 'fx', l: '환율 (해외만, 원/$)', type: 'number' },
      { k: 'account', l: '단타 투자금 (해외는 $) · 넣으면 음봉 단타 적용', type: 'money' },
      { k: 'units', l: '단타로 산 양 (0~5, 1 = 투자금의 20%)', type: 'number' },
      memo,
    ],
    cols: [
      'broker', 'name', 'qty', 'avg', 'price',
      { k: '_val', l: '평가금액', type: 'won', fn: r => num(r.qty) * num(r.price) * fxOf(r) },
      { k: '_pl', l: '수익률', type: 'pct', fn: r => (num(r.avg) && num(r.price) ? (num(r.price) / num(r.avg) - 1) * 100 : '') },
      { k: '_tp', l: '익절가', type: 'money', fn: r => (num(r.account) ? levels(r.avg, isUS(r)).tp ?? '' : '') },
      { k: '_sl', l: '손절가', type: 'money', fn: r => (num(r.account) ? levels(r.avg, isUS(r)).sl ?? '' : '') },
    ],
    // 해외 종목은 금액을 달러로 적고, 평가금액만 환율로 원화 환산
    cur: r => (isUS(r) ? '$' : ''),
    value: r => num(r.qty) * num(r.price) * fxOf(r),
    label: r => r.name,
  },
  pension: {
    title: '퇴직연금·연금',
    fields: [
      { k: 'type', l: '유형', type: 'select', opts: ['DC', 'DB', 'IRP', '연금저축펀드', '연금저축보험', '국민연금', '기타'] },
      { k: 'company', l: '금융사' },
      { k: 'name', l: '상품/계좌명' },
      { k: 'balance', l: '적립금', type: 'money' },
      { k: 'monthly', l: '월 납입', type: 'money' },
      { k: 'returnRate', l: '수익률(%)', type: 'number' },
      { k: 'asOf', l: '기준일', type: 'date' },
      memo,
    ],
    cols: ['type', 'company', 'name', 'balance', 'monthly', 'returnRate', 'asOf'],
    value: r => num(r.balance),
    label: r => [r.type, r.company].filter(Boolean).join(' '),
  },
  savings: {
    title: '예적금·현금',
    fields: [
      { k: 'kind', l: '종류', type: 'select', opts: ['입출금', '예금', '적금', 'CMA', '청약', '외화', '현금', '기타'] },
      { k: 'bank', l: '은행/기관' },
      { k: 'name', l: '상품/계좌명' },
      { k: 'balance', l: '잔액', type: 'money' },
      { k: 'rate', l: '금리(%)', type: 'number' },
      { k: 'monthly', l: '월 납입', type: 'money' },
      { k: 'maturity', l: '만기일', type: 'date', due: '예적금 만기' },
      memo,
    ],
    cols: ['kind', 'bank', 'name', 'balance', 'rate', 'maturity'],
    value: r => num(r.balance),
    label: r => [r.bank, r.name].filter(Boolean).join(' '),
  },
  realestate: {
    title: '부동산',
    fields: [
      { k: 'kind', l: '종류', type: 'select', opts: ['아파트', '주택', '오피스텔', '토지', '상가', '전세보증금', '월세보증금', '기타'] },
      { k: 'name', l: '이름', req: true },
      { k: 'address', l: '주소' },
      { k: 'value', l: '시세/보증금', type: 'money' },
      { k: 'purchase', l: '매입가', type: 'money' },
      { k: 'asOf', l: '기준일', type: 'date' },
      memo,
    ],
    cols: ['kind', 'name', 'value', 'purchase', 'asOf'],
    value: r => num(r.value),
    label: r => r.name,
  },
  loans: {
    title: '대출',
    fields: [
      { k: 'kind', l: '종류', type: 'select', opts: ['주택담보', '전세', '신용', '마이너스', '학자금', '자동차', '기타'] },
      { k: 'bank', l: '금융사' },
      { k: 'name', l: '상품명' },
      { k: 'balance', l: '잔액', type: 'money' },
      { k: 'rate', l: '금리(%)', type: 'number' },
      { k: 'payment', l: '월 상환', type: 'money' },
      { k: 'maturity', l: '만기일', type: 'date', due: '대출 만기' },
      memo,
    ],
    cols: ['kind', 'bank', 'name', 'balance', 'rate', 'payment', 'maturity'],
    debt: r => num(r.balance),
    label: r => [r.bank, r.name].filter(Boolean).join(' '),
  },

  education: {
    title: '교육',
    fields: [
      person,
      { k: 'kind', l: '종류', type: 'select', opts: ['학원', '과외', '학교', '온라인강의', '자격증', '독서', '캠프', '기타'] },
      { k: 'name', l: '이름', req: true },
      { k: 'org', l: '기관/선생님' },
      { k: 'status', l: '상태', type: 'select', opts: ['진행중', '예정', '완료', '중단'] },
      { k: 'days', l: '요일', type: 'days' },
      { k: 't1', l: '시작 시간', type: 'time' },
      { k: 't2', l: '끝 시간', type: 'time' },
      { k: 'schedule', l: '일정 메모', hint: '예: 격주 토요일, 방학 중 휴강' },
      { k: 'fee', l: '월 비용', type: 'money' },
      { k: 'start', l: '시작일', type: 'date' },
      { k: 'end', l: '종료일', type: 'date', due: '교육 종료' },
      { k: 'contact', l: '연락처' },
      { k: 'url', l: '링크', type: 'url' },
      memo,
    ],
    cols: ['person', 'kind', 'name', 'org', 'status', { k: '_when', l: '일정', type: 'text', fn: whenText }, 'fee', 'end'],
    monthly: r => (r.status === '진행중' ? num(r.fee) : 0),
    label: r => [r.person, r.name].filter(Boolean).join(' · '),
  },

  records: {
    title: '측정 기록',
    fields: [
      { k: 'date', l: '날짜', type: 'date', req: true },
      person,
      { k: 'weight', l: '체중(kg)', type: 'number' },
      { k: 'sys', l: '수축기 혈압', type: 'number' },
      { k: 'dia', l: '이완기 혈압', type: 'number' },
      { k: 'pulse', l: '맥박', type: 'number' },
      { k: 'sugar', l: '혈당', type: 'number' },
      memo,
    ],
    cols: ['date', 'person', 'weight', { k: '_bp', l: '혈압', type: 'text', fn: r => (r.sys || r.dia ? `${r.sys || '-'}/${r.dia || '-'}` : '') }, 'pulse', 'sugar', 'memo'],
    sort: { k: 'date', dir: -1 },
  },
  checkups: {
    title: '검진',
    fields: [
      { k: 'date', l: '검진일', type: 'date' },
      person,
      { k: 'kind', l: '종류', type: 'select', opts: ['일반검진', '종합검진', '암검진', '치과', '안과', '예방접종', '기타'] },
      { k: 'hospital', l: '병원' },
      { k: 'result', l: '결과', type: 'textarea' },
      { k: 'next', l: '다음 예정일', type: 'date', due: '검진 예정' },
      memo,
    ],
    cols: ['date', 'person', 'kind', 'hospital', 'result', 'next'],
    sort: { k: 'date', dir: -1 },
    label: r => [r.person, r.kind].filter(Boolean).join(' · '),
  },
  meds: {
    title: '복용약',
    fields: [
      person,
      { k: 'name', l: '약 이름', req: true },
      { k: 'purpose', l: '용도' },
      { k: 'dose', l: '용량/횟수', hint: '예: 1정, 아침 식후' },
      { k: 'start', l: '시작일', type: 'date' },
      { k: 'end', l: '종료일', type: 'date', due: '복약 종료' },
      { k: 'hospital', l: '처방 병원' },
      memo,
    ],
    cols: ['person', 'name', 'purpose', 'dose', 'start', 'end'],
    label: r => [r.person, r.name].filter(Boolean).join(' · '),
  },
  hospitals: {
    title: '병원',
    fields: [
      { k: 'name', l: '병원명', req: true },
      { k: 'dept', l: '진료과' },
      { k: 'doctor', l: '담당의' },
      { k: 'phone', l: '전화' },
      { k: 'address', l: '주소' },
      { k: 'url', l: '예약 링크', type: 'url' },
      memo,
    ],
    cols: ['name', 'dept', 'doctor', 'phone', 'address'],
  },

  links: {
    title: '링크',
    fields: [
      { k: 'name', l: '이름', req: true },
      { k: 'url', l: '주소', type: 'url', req: true },
      { k: 'folder', l: '폴더', type: 'folder' },
      { k: 'pin', l: '★ 즐겨찾기', type: 'check' },
      memo,
    ],
    cols: [],
    noAttach: true,
  },

  // 첨부 파일 정보 (화면에 표로 나오지 않음). pk/pid = 붙어 있는 목록/항목, 자료실이면 pk = 'library'
  files: { title: '파일', fields: [], cols: [], noAttach: true },
};

// 목록이 아닌 특별한 탭
export const VIEWS = { timetable: '시간표' };

export const SECTIONS = [
  { id: 'tasks', title: '할 일' },
  { id: 'assets', title: '자산관리', tabs: ['stocks', 'pension', 'savings', 'insurance', 'realestate', 'loans'] },
  { id: 'education', title: '교육', tabs: ['education', 'timetable'] },
  { id: 'health', title: '건강', tabs: ['records', 'checkups', 'meds', 'hospitals'] },
  { id: 'library', title: '자료실' },
  { id: 'links', title: '링크' },
];

export const ASSET_KEYS = SECTIONS.find(s => s.id === 'assets').tabs;

export function emptyData() {
  return {
    items: Object.fromEntries(Object.keys(COLLECTIONS).map(k => [k, []])),
    sys: { repos: [] },
  };
}
