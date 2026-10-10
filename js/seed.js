// Starting data: the DPWS loco position sheet dated 08-10-2026.
import { uid, pick, emptyState, foisRemark, foisDateFromRemarks } from './logic.js';

const fois = (day) => foisRemark(day);

// [locoNo, dueDate, trainNo, location, hoTrain, hoPoint, hoTime, remarks, sameSerial]
const OTHER = [
  ['44323+42372', '15-Oct', 'TMU', 'UMB/UMB/NR', 'CDG', 'WADI', '31-07-26 13:05', fois('2026-08-30')],
  ['28347+27744', '29-Sep', 'TMU', 'BRPS/MLDT/ER', 'SMGP', 'MTMI', '06-09-26 9:00', fois('2026-09-06')],
  ['28352+28443', '28-Nov', 'MSGM/NMG', 'BSS/UMD/NR', 'CCIK/BCFCL', 'WADI', '30-08-26 21:15', fois('2026-09-01')],
  ['27381+27324', 'FRESH', 'AMED/BOXNHL', 'WR/NGP/CR', 'MILK', 'WADI', '23-09-26 5:50', fois('2026-09-23')],
  ['27592+27764', 'FRESH', 'MNF', 'NYN/PRYJ/NR', 'KSNK', 'LUR', '06-10-26 15:45', fois('2026-10-06')],
  ['27337', '10-Oct', 'JSPK', 'GAYA/DDU/EC', 'P-52', 'NED', '27-08-26 15:47', fois('2026-10-05')],
  ['27360', '', 'T L/E', 'KQA/GTL/SCOR', '762', 'MTMI', '06-10-26 0:15', fois('2026-10-06'), true],
  ['27383+28343', '27-Oct', 'JSWT', 'NZB/HYB/SC', 'JSWT', 'NZB', '08-10-26 4:50', fois('2026-10-08')],
];

// [locoNo, dueDate, trainNo, location, working, remarks]
const SC = [
  ['27609+28411', 'FRESH', 'SCGP/BOXNL', 'SUH', 'YES', ''],
  ['28073+28526', '', 'CE/NMG', 'ZB ON RUN', 'YES', ''],
  ['27300+27402', 'FRESH', 'TMU', 'YTPV SDG', 'YES', ''],
  ['28346+28306', 'FRESH', 'TMU', 'GXSG', 'YES', 'MCI SECTOR'],
  // The sheet showed 46121 and 46274 here, which are Excel date serials.
  ['27731+28305', '09-Apr', 'TMU', 'LGD SHED', 'DEFICTIVE', 'TO LGD SHED'],
  ['28746+28748', '27-Sep', 'TMU', 'DKJ', '-', 'PLANNING FOR BOXN/E TO'],
  ['28017+27729', '09-Sep', 'TMU', 'KZJ', 'Shed in', 'Shed in'],
  ['28665+28747', 'FRESH', 'TMU', 'GDRA', 'YES', ''],
  ['27294+28066', 'FRESH', 'H-34/BOXNE', 'MLYG ON RUN', '', ''],
  ['27608+27336', '21-Aug', 'W-94/BOXNE', 'BN ON RUN', '', ''],
];

export function seedState() {
  const at = new Date(2026, 9, 8, 18, 0).toISOString();
  const state = emptyState();
  const add = (fields) => {
    const loco = { id: uid(), updatedAt: at, ...pick(fields) };
    state.locos.push(loco);
    state.log.push({ id: uid(), locoId: loco.id, at, kind: 'created', data: pick(loco) });
  };
  for (const [locoNo, dueDate, trainNo, location, hoTrain, hoPoint, hoTime, remarks, sameSerial] of OTHER) {
    add({ locoNo, dueDate, trainNo, location, division: 'OTHER', hoTrain, hoPoint, hoTime, foisDate: foisDateFromRemarks(remarks), working: '', remarks, sameSerial: !!sameSerial });
  }
  for (const [locoNo, dueDate, trainNo, location, working, remarks] of SC) {
    add({ locoNo, dueDate, trainNo, location, division: 'SC', hoTrain: '', hoPoint: '', hoTime: '', working, remarks, sameSerial: false });
  }
  return state;
}
