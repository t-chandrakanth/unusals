// Two older reports kept as examples of the C&W and loco sheet layouts, loaded
// once with the other records (see app.js). Fixed ids, so never duplicated.

export const EXTRA_RECORDS = [
  {
    id: 'imp-u-2025-04-03-1', type: 'cw', day: '2025-04-03', title: 'brake binding',
    location: 'TNGM-YP/GNN', trainNo: 'ICDT C/S', locoNo: '42821', load: '',
    reason: 'BRAKE BINDINDING FOUND TNGM -YP AT 10:58 WAGON NO CNCR 6125060159 BLCM 16 TH FROM BV ,SAME ISOLATED AND STARTED 11:10, GNN ARR 11:50, TXR FIT 15:10, GNN DEP-16:45.',
    wagonNo: 'CNCR 6125060159 BLCM', bpcNo: '70000102716 TKD/25-03/CC', det: 'AT GNN 03:20 HRS',
  },
  {
    id: 'imp-u-2025-04-16-1', type: 'loco', day: '2025-04-16', title: 'LOCO TROUBLE',
    location: 'ALER', trainNo: 'AYB', locoNo: '32425/AQ/03/07', load: '40/40/3910',
    reason: 'ALER ARR 14:24 AFTER ALER ARR LOCO TROUBLE LOCO DETACHED AT 15:30 -LOCO ALER DEP 16:07 AND DMU(49545+49522)ARR 19:10 EOT:20:10 READY 20:55',
    wagonNo: '', bpcNo: '', det: '',
  },
];
