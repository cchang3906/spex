export type BenchMode = "on" | "baseline";

export interface BenchRow {
  round: number;
  mode: BenchMode;
  instance: string;
  wallMs: number;
  resolved: boolean;
  savedMs: number;
  hits: number;
  misses: number;
  speculations: number;
  wastedMs: number;
  tokens: number;
  verifyStallMs: number;
  toolWaits?: number[];
  codexVersion?: string;
}

export const results: BenchRow[] = [
  {
    "round": 1,
    "mode": "on",
    "instance": "pytest-dev__pytest-10051",
    "wallMs": 69320,
    "resolved": false,
    "savedMs": 76,
    "hits": 1,
    "misses": 0,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 146680,
    "verifyStallMs": 0,
    "toolWaits": [
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "pytest-dev__pytest-10051",
    "wallMs": 166534,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 680946,
    "verifyStallMs": 650,
    "toolWaits": [
      1,
      0,
      112,
      186,
      177,
      174
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-21379",
    "wallMs": 126293,
    "resolved": false,
    "savedMs": 7966,
    "hits": 1,
    "misses": 1,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 401431,
    "verifyStallMs": 24423,
    "toolWaits": [
      9760,
      14663
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-21379",
    "wallMs": 190161,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 846630,
    "verifyStallMs": 17677,
    "toolWaits": [
      17677
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-21596",
    "wallMs": 166102,
    "resolved": false,
    "savedMs": 1425,
    "hits": 1,
    "misses": 2,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 1125647,
    "verifyStallMs": 2764,
    "toolWaits": [
      0,
      1389,
      1375
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-21596",
    "wallMs": 209452,
    "resolved": false,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 1108773,
    "verifyStallMs": 3550,
    "toolWaits": [
      1402,
      1359,
      270,
      519
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-21930",
    "wallMs": 99603,
    "resolved": false,
    "savedMs": 8265,
    "hits": 2,
    "misses": 2,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 328882,
    "verifyStallMs": 17884,
    "toolWaits": [
      0,
      6602,
      6483,
      4799
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-21930",
    "wallMs": 308224,
    "resolved": false,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 298867,
    "verifyStallMs": 16566,
    "toolWaits": [
      6542,
      3324,
      6700
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 2,
    "mode": "on",
    "instance": "pytest-dev__pytest-10051",
    "wallMs": 64934,
    "resolved": false,
    "savedMs": 74,
    "hits": 1,
    "misses": 0,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 152196,
    "verifyStallMs": 1,
    "toolWaits": [
      1
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 2,
    "mode": "baseline",
    "instance": "pytest-dev__pytest-10051",
    "wallMs": 76234,
    "resolved": false,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 239310,
    "verifyStallMs": 119,
    "toolWaits": [
      0,
      119
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 2,
    "mode": "on",
    "instance": "sympy__sympy-21379",
    "wallMs": 175152,
    "resolved": true,
    "savedMs": 29679,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 917586,
    "verifyStallMs": 2490,
    "toolWaits": [
      2490,
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 2,
    "mode": "baseline",
    "instance": "sympy__sympy-21379",
    "wallMs": 188583,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 803673,
    "verifyStallMs": 20162,
    "toolWaits": [
      18845,
      307,
      566,
      444
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 2,
    "mode": "on",
    "instance": "sympy__sympy-21596",
    "wallMs": 170926,
    "resolved": false,
    "savedMs": 1440,
    "hits": 1,
    "misses": 1,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 905207,
    "verifyStallMs": 1403,
    "toolWaits": [
      0,
      1403
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 2,
    "mode": "baseline",
    "instance": "sympy__sympy-21596",
    "wallMs": 155034,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 1218680,
    "verifyStallMs": 7350,
    "toolWaits": [
      1360,
      1344,
      918,
      911,
      1409,
      1408
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 2,
    "mode": "on",
    "instance": "sympy__sympy-21930",
    "wallMs": 124619,
    "resolved": false,
    "savedMs": 10776,
    "hits": 3,
    "misses": 1,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 446620,
    "verifyStallMs": 14340,
    "toolWaits": [
      0,
      5433,
      2458,
      6449
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 2,
    "mode": "baseline",
    "instance": "sympy__sympy-21930",
    "wallMs": 277221,
    "resolved": false,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 275127,
    "verifyStallMs": 13227,
    "toolWaits": [
      6481,
      632,
      6114
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-20154",
    "wallMs": 101828,
    "resolved": false,
    "savedMs": 1174,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 308422,
    "verifyStallMs": 2,
    "toolWaits": [
      1,
      1
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-19495",
    "wallMs": 117075,
    "resolved": false,
    "savedMs": 998,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 407753,
    "verifyStallMs": 0,
    "toolWaits": [
      0,
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-19040",
    "wallMs": 133179,
    "resolved": true,
    "savedMs": 1655,
    "hits": 1,
    "misses": 1,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 973186,
    "verifyStallMs": 1661,
    "toolWaits": [
      1,
      1660
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-20428",
    "wallMs": 131058,
    "resolved": true,
    "savedMs": 3062,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 1006770,
    "verifyStallMs": 5877,
    "toolWaits": [
      0,
      5877
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-20154",
    "wallMs": 78285,
    "resolved": false,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 226233,
    "verifyStallMs": 887,
    "toolWaits": [
      436,
      451
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-19495",
    "wallMs": 96463,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 319588,
    "verifyStallMs": 707,
    "toolWaits": [
      341,
      366
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-20428",
    "wallMs": 99929,
    "resolved": false,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 566327,
    "verifyStallMs": 2309,
    "toolWaits": [
      1631,
      343,
      335
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-20590",
    "wallMs": 59964,
    "resolved": true,
    "savedMs": 651,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 273608,
    "verifyStallMs": 0,
    "toolWaits": [
      0,
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-20916",
    "wallMs": 48422,
    "resolved": false,
    "savedMs": 364,
    "hits": 1,
    "misses": 0,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 205214,
    "verifyStallMs": 0,
    "toolWaits": [
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-20590",
    "wallMs": 68280,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 255428,
    "verifyStallMs": 604,
    "toolWaits": [
      305,
      299
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-19040",
    "wallMs": 192944,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 2374783,
    "verifyStallMs": 3905,
    "toolWaits": [
      1458,
      357,
      297,
      1394,
      399
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-20438",
    "wallMs": 121332,
    "resolved": false,
    "savedMs": 2781,
    "hits": 2,
    "misses": 1,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 1156228,
    "verifyStallMs": 2183,
    "toolWaits": [
      0,
      526,
      1657
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-20916",
    "wallMs": 83213,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 314273,
    "verifyStallMs": 1055,
    "toolWaits": [
      376,
      425,
      254
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-22914",
    "wallMs": 60980,
    "resolved": true,
    "savedMs": 645,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 275546,
    "verifyStallMs": 0,
    "toolWaits": [
      0,
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-22080",
    "wallMs": 125784,
    "resolved": false,
    "savedMs": 897,
    "hits": 1,
    "misses": 3,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 579395,
    "verifyStallMs": 2029,
    "toolWaits": [
      1,
      726,
      652,
      650
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-20438",
    "wallMs": 122128,
    "resolved": false,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 1246940,
    "verifyStallMs": 9378,
    "toolWaits": [
      1565,
      519,
      1545,
      298,
      262,
      1741,
      1503,
      1627,
      318
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-22456",
    "wallMs": 168123,
    "resolved": true,
    "savedMs": 836,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 1514219,
    "verifyStallMs": 2,
    "toolWaits": [
      1,
      1
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-22914",
    "wallMs": 70523,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 269375,
    "verifyStallMs": 627,
    "toolWaits": [
      361,
      266
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-23262",
    "wallMs": 69583,
    "resolved": false,
    "savedMs": 635,
    "hits": 1,
    "misses": 0,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 278767,
    "verifyStallMs": 1,
    "toolWaits": [
      1
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-22714",
    "wallMs": 144595,
    "resolved": true,
    "savedMs": 1917,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 1100549,
    "verifyStallMs": 0,
    "toolWaits": [
      0,
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-22080",
    "wallMs": 180568,
    "resolved": false,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 1212519,
    "verifyStallMs": 5393,
    "toolWaits": [
      675,
      605,
      571,
      290,
      223,
      588,
      249,
      339,
      300,
      726,
      287,
      540
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-23262",
    "wallMs": 71814,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 428082,
    "verifyStallMs": 876,
    "toolWaits": [
      520,
      356
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-22456",
    "wallMs": 178416,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 2104443,
    "verifyStallMs": 2472,
    "toolWaits": [
      287,
      361,
      1824
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-22714",
    "wallMs": 99142,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 557443,
    "verifyStallMs": 3018,
    "toolWaits": [
      891,
      983,
      951,
      193
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-23413",
    "wallMs": 102446,
    "resolved": true,
    "savedMs": 835,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 476808,
    "verifyStallMs": 1,
    "toolWaits": [
      1,
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-23534",
    "wallMs": 65461,
    "resolved": true,
    "savedMs": 770,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 335291,
    "verifyStallMs": 1,
    "toolWaits": [
      0,
      1
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-23950",
    "wallMs": 91560,
    "resolved": true,
    "savedMs": 730,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 567890,
    "verifyStallMs": 0,
    "toolWaits": [
      0,
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-23534",
    "wallMs": 60628,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 311567,
    "verifyStallMs": 605,
    "toolWaits": [
      332,
      273
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-23413",
    "wallMs": 80361,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 236110,
    "verifyStallMs": 1243,
    "toolWaits": [
      369,
      304,
      343,
      227
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-24066",
    "wallMs": 97430,
    "resolved": false,
    "savedMs": 1713,
    "hits": 1,
    "misses": 0,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 384814,
    "verifyStallMs": 0,
    "toolWaits": [
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-23950",
    "wallMs": 68532,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 413032,
    "verifyStallMs": 598,
    "toolWaits": [
      242,
      356
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-24443",
    "wallMs": 56907,
    "resolved": false,
    "savedMs": 573,
    "hits": 1,
    "misses": 0,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 177862,
    "verifyStallMs": 0,
    "toolWaits": [
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-24539",
    "wallMs": 42282,
    "resolved": true,
    "savedMs": 838,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 167980,
    "verifyStallMs": 1,
    "toolWaits": [
      1,
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-24213",
    "wallMs": 103863,
    "resolved": true,
    "savedMs": 1035,
    "hits": 2,
    "misses": 0,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 778310,
    "verifyStallMs": 0,
    "toolWaits": [
      0,
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-24066",
    "wallMs": 90372,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 558694,
    "verifyStallMs": 887,
    "toolWaits": [
      494,
      393
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-24539",
    "wallMs": 28672,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 89978,
    "verifyStallMs": 685,
    "toolWaits": [
      358,
      327
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-24443",
    "wallMs": 97282,
    "resolved": false,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 490489,
    "verifyStallMs": 460,
    "toolWaits": [
      460
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-24661",
    "wallMs": 65983,
    "resolved": false,
    "savedMs": 652,
    "hits": 1,
    "misses": 0,
    "speculations": 1,
    "wastedMs": 0,
    "tokens": 431131,
    "verifyStallMs": 0,
    "toolWaits": [
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-24213",
    "wallMs": 95096,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 458690,
    "verifyStallMs": 2868,
    "toolWaits": [
      592,
      400,
      448,
      626,
      450,
      352
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "on",
    "instance": "sympy__sympy-24562",
    "wallMs": 142087,
    "resolved": true,
    "savedMs": 3255,
    "hits": 2,
    "misses": 1,
    "speculations": 2,
    "wastedMs": 0,
    "tokens": 544424,
    "verifyStallMs": 1434,
    "toolWaits": [
      0,
      1434,
      0
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-24661",
    "wallMs": 101495,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 786015,
    "verifyStallMs": 952,
    "toolWaits": [
      500,
      452
    ],
    "codexVersion": "codex-cli 0.144.5"
  },
  {
    "round": 1,
    "mode": "baseline",
    "instance": "sympy__sympy-24562",
    "wallMs": 81214,
    "resolved": true,
    "savedMs": 0,
    "hits": 0,
    "misses": 0,
    "speculations": 0,
    "wastedMs": 0,
    "tokens": 572126,
    "verifyStallMs": 2512,
    "toolWaits": [
      1848,
      293,
      371
    ],
    "codexVersion": "codex-cli 0.144.5"
  }
];

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function modeMedian(
  rows: BenchRow[],
  mode: BenchMode,
  pick: (row: BenchRow) => number,
  resolvedOnly = false,
): number | null {
  const filtered = rows.filter(
    (row) => row.mode === mode && (!resolvedOnly || row.resolved),
  );
  return median(filtered.map(pick));
}

export function instanceNames(rows: BenchRow[]): string[] {
  return [...new Set(rows.map((row) => row.instance))];
}

export function percentDelta(
  baseline: number | null,
  on: number | null,
): number | null {
  if (baseline === null || on === null || baseline === 0) {
    return null;
  }
  return ((on - baseline) / baseline) * 100;
}
