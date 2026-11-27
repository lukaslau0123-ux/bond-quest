/* ============================================================
   Bond Quest — data layer
   All chemistry content verified against F4 syllabus conventions.
   ============================================================ */

const ZONES = {
  A: { key:'A', en:'Ionic Plains',       zh:'離子平原', cx:-60, cz:-60,
       fog:0xa9cadb, sky:0xd6ebf5, skyTop:0x3f7fb4, skyBot:0xd9ecf6, ground:[0.26,0.33,0.31] },
  B: { key:'B', en:'Covalent Forest',    zh:'共價森林', cx: 60, cz:-60,
       fog:0x8dbf9a, sky:0xc9e6d2, skyTop:0x2f6a4a, skyBot:0xcbe8d4, ground:[0.12,0.28,0.16] },
  C: { key:'C', en:'Metallic Mountains', zh:'金屬山脈', cx:-60, cz: 60,
       fog:0xa3aab5, sky:0xc4c9d2, skyTop:0x535c6b, skyBot:0xc9ced6, ground:[0.26,0.25,0.24] },
  D: { key:'D', en:'Crystal Cavern',     zh:'晶體洞窟', cx: 60, cz: 60,
       fog:0x3b2f57, sky:0x322547, skyTop:0x1d1533, skyBot:0x5c4a86, ground:[0.10,0.08,0.19] }
};

/* ---------- classification compounds ----------
   comp:  composition step  1 = metal+non-metal, 2 = non-metal+non-metal, 3 = metal only
   ebeh:  electron behaviour 1 = transfer, 2 = sharing, 3 = delocalised
   bond:  bond type 1 = ionic, 2 = covalent, 3 = metallic
   trap:  optional misconception distractor on a given step
*/
const COMPOUNDS = [
  { id:'nacl', f:'NaCl', zh:'氯化鈉', comp:1, ebeh:1, bond:1, tier:1,
    trap:{ step:1, en:'NaCl is made of molecules, so it is covalent.', zh:'NaCl 由分子組成，所以係共價鍵。',
      why:{ en:'NaCl is not molecular — it is a giant ionic lattice of Na⁺ and Cl⁻ ions. The formula only shows the ratio 1:1, not a molecule.',
            zh:'NaCl 唔係分子，而係 Na⁺ 同 Cl⁻ 組成嘅巨型離子晶格。化學式只表示 1:1 比例，唔係一個分子。' } } },

  { id:'na2o', f:'Na₂O', zh:'氧化鈉', comp:1, ebeh:1, bond:1, tier:1 },

  { id:'h2', f:'H₂', zh:'氫氣', comp:2, ebeh:2, bond:2, tier:1 },

  { id:'fe', f:'Fe', zh:'鐵', comp:3, ebeh:3, bond:3, tier:1 },

  { id:'o2', f:'O₂', zh:'氧氣', comp:2, ebeh:2, bond:2, tier:2,
    trap:{ step:3, en:'O₂ has two separate weak single bonds.', zh:'O₂ 有兩條分開嘅弱單鍵。',
      why:{ en:'O=O is ONE double bond — a single region of shared electron density. A double bond is shorter and stronger than a single bond, not two weak bonds.',
            zh:'O=O 係一條雙鍵，即一處共用電子密度。雙鍵比單鍵更短更強，唔係兩條弱單鍵。' } } },

  { id:'na', f:'Na', zh:'鈉', comp:3, ebeh:3, bond:3, tier:1 },

  { id:'mgcl2', f:'MgCl₂', zh:'氯化鎂', comp:1, ebeh:1, bond:1, tier:2 },

  { id:'cao', f:'CaO', zh:'氧化鈣', comp:1, ebeh:1, bond:1, tier:2 },

  { id:'h2o', f:'H₂O', zh:'水', comp:2, ebeh:2, bond:2, tier:2 },

  { id:'co2', f:'CO₂', zh:'二氧化碳', comp:2, ebeh:2, bond:2, tier:2,
    trap:{ step:2, en:'CO₂ conducts electricity because it has shared electrons.', zh:'CO₂ 有共用電子，所以導電。',
      why:{ en:'Shared electrons in a covalent bond are localised between the two atoms. CO₂ has no free electrons and no ions, so it does NOT conduct.',
            zh:'共價鍵嘅共用電子被局限喺兩粒原子之間。CO₂ 冇自由電子亦冇離子，所以唔導電。' } } },

  { id:'ch4', f:'CH₄', zh:'甲烷', comp:2, ebeh:2, bond:2, tier:2 },

  { id:'cl2', f:'Cl₂', zh:'氯氣', comp:2, ebeh:2, bond:2, tier:2 },

  { id:'hcl', f:'HCl', zh:'氯化氫', comp:2, ebeh:2, bond:2, tier:2 },

  { id:'cu', f:'Cu', zh:'銅', comp:3, ebeh:3, bond:3, tier:2,
    trap:{ step:2, en:'Electrons are transferred from Cu atoms to other atoms.', zh:'電子由 Cu 原子轉移去其他原子。',
      why:{ en:'In metallic bonding the valence electrons are delocalised into a "sea of electrons" that attracts the positive metal ions. They are NOT transferred to another atom.',
            zh:'金屬鍵入面，價電子會離域成「電子海」，吸引正金屬離子，而唔係轉移去另一粒原子。' } } },

  { id:'al', f:'Al', zh:'鋁', comp:3, ebeh:3, bond:3, tier:2 },

  { id:'zn', f:'Zn', zh:'鋅', comp:3, ebeh:3, bond:3, tier:2 },

  { id:'nh3', f:'NH₃', zh:'氨', comp:2, ebeh:2, bond:2, tier:3,
    trap:{ step:2, en:'The lone pair on N is shared with the three H atoms.', zh:'N 上面嘅孤對電子同 3 個 H 共用。',
      why:{ en:'A lone pair belongs to ONE atom only and is not shared. Only a bond pair is shared between two atoms. In NH₃, N has 3 bond pairs and 1 lone pair.',
            zh:'孤對電子只屬於一粒原子，唔會共用。只有鍵對先係兩粒原子共用。NH₃ 入面 N 有 3 對鍵對同 1 對孤對。' } } },

  { id:'bf3', f:'BF₃', zh:'三氟化硼', comp:2, ebeh:2, bond:2, tier:3,
    trap:{ step:3, en:'B in BF₃ has a full octet and one lone pair.', zh:'BF₃ 入面 B 有完整八隅體同一對孤對電子。',
      why:{ en:'Boron has only 3 valence electrons. In BF₃ it forms 3 bond pairs (6 electrons) and has NO lone pair — it is electron-deficient.',
            zh:'硼只有 3 粒價電子。BF₃ 入面 B 形成 3 對鍵對（6 粒電子），冇孤對電子，屬缺電子。' } } },

  { id:'bcl3', f:'BCl₃', zh:'三氯化硼', comp:2, ebeh:2, bond:2, tier:3 },

  { id:'so2', f:'SO₂', zh:'二氧化硫', comp:2, ebeh:2, bond:2, tier:3 },

  { id:'ph3', f:'PH₃', zh:'磷化氫', comp:2, ebeh:2, bond:2, tier:3 },

  { id:'mg3n2', f:'Mg₃N₂', zh:'氮化鎂', comp:1, ebeh:1, bond:1, tier:3 },

  { id:'nh4cl', f:'NH₄Cl', zh:'氯化銨', comp:2, ebeh:1, bond:1, tier:3,
    note:{ en:'NH₄Cl is ionic even though all its elements are non-metals. The NH₄⁺ ion contains covalent N–H bonds. Attraction between NH₄⁺ and Cl⁻ holds the lattice together.',
           zh:'陷阱題：全部元素都係非金屬，但 NH₄Cl 係離子化合物。NH₄⁺ 係多原子陽離子，電子轉移發生喺 NH₄⁺ 同 Cl⁻ 之間。' } },

  { id:'diamond', f:'diamond', zh:'鑽石', comp:2, ebeh:2, bond:2, tier:3,
    note:{ en:'Giant covalent structure: each C atom shares 4 pairs with 4 neighbours — very high melting point, does not conduct.',
           zh:'巨型共價結構：每粒 C 同 4 個鄰居共用 4 對電子 — 熔點極高、唔導電。' } },

  { id:'graphite', f:'graphite', zh:'石墨', comp:2, ebeh:2, bond:2, tier:3,
    note:{ en:'Graphite has layers. Each carbon bonds to three neighbours. Delocalised electrons can move along the layers and carry charge.',
           zh:'巨型共價但分層：每粒 C 同 3 個鄰居成鍵；第 4 粒電子喺層與層之間離域 — 所以石墨導電。' } },

  { id:'c60', f:'C₆₀', zh:'富勒烯', comp:2, ebeh:2, bond:2, tier:3,
    note:{ en:'Simple molecular: C₆₀ molecules are held by weak forces between molecules — low melting point.',
           zh:'簡單分子：C₆₀ 分子之間只靠微弱作用力 — 熔點低。' } },

  { id:'au', f:'Au', zh:'金', comp:3, ebeh:3, bond:3, tier:3 }
];

/* ---------- dot-and-cross questions ----------
   atoms: {sym, x, y, r, charge, lonePairs, bondPairs}
   bonds: {a, b, pairs}
*/
const DOTCROSS = [
  { id:'dc-nacl', compound:'NaCl', type:'ionic', tier:1,
    atoms:[
      { sym:'Na', x:250, y:250, r:78, charge:1,  lonePairs:0, bondPairs:0 },
      { sym:'Cl', x:540, y:250, r:78, charge:-1, lonePairs:4, bondPairs:0 }
    ], bonds:[],
    hint:{ en:'Na loses its 1 outer electron → Na⁺ (no outer electrons). Cl gains 1 → Cl⁻ with 8 outer electrons (4 lone pairs).',
           zh:'Na 失去 1 粒最外層電子 → Na⁺（冇最外層電子）。Cl 得到 1 粒 → Cl⁻，有 8 粒最外層電子（4 對孤對）。' } },

  { id:'dc-mgo', compound:'MgO', type:'ionic', tier:2,
    atoms:[
      { sym:'Mg', x:250, y:250, r:78, charge:2,  lonePairs:0, bondPairs:0 },
      { sym:'O',  x:540, y:250, r:78, charge:-2, lonePairs:4, bondPairs:0 }
    ], bonds:[],
    hint:{ en:'Mg loses 2 outer electrons → Mg²⁺. O gains 2 → O²⁻ with 8 outer electrons.',
           zh:'Mg 失去 2 粒最外層電子 → Mg²⁺。O 得到 2 粒 → O²⁻，有 8 粒最外層電子。' } },

  { id:'dc-h2', compound:'H₂', type:'covalent', tier:1,
    atoms:[
      { sym:'H', x:300, y:250, r:64, lonePairs:0, bondPairs:1 },
      { sym:'H', x:480, y:250, r:64, lonePairs:0, bondPairs:1 }
    ], bonds:[{a:0,b:1,pairs:1}],
    hint:{ en:'Each H has 1 electron. They share one pair (1 dot + 1 cross) so each H has a full outer shell of 2.',
           zh:'每粒 H 有 1 粒電子。佢哋共用一對（1 點 + 1 叉），令每粒 H 都有 2 粒電子嘅完整最外層。' } },

  { id:'dc-cl2', compound:'Cl₂', type:'covalent', tier:2,
    atoms:[
      { sym:'Cl', x:250, y:250, r:78, lonePairs:3, bondPairs:1 },
      { sym:'Cl', x:540, y:250, r:78, lonePairs:3, bondPairs:1 }
    ], bonds:[{a:0,b:1,pairs:1}],
    hint:{ en:'Each Cl has 7 outer electrons: 3 lone pairs plus 1 shared pair. Total 8 around each Cl.',
           zh:'每粒 Cl 有 7 粒最外層電子：3 對孤對加 1 對共用。每粒 Cl 周圍共 8 粒。' } },

  { id:'dc-hcl', compound:'HCl', type:'covalent', tier:2,
    atoms:[
      { sym:'H',  x:300, y:250, r:64, lonePairs:0, bondPairs:1 },
      { sym:'Cl', x:510, y:250, r:78, lonePairs:3, bondPairs:1 }
    ], bonds:[{a:0,b:1,pairs:1}],
    hint:{ en:'H shares its 1 electron; Cl shares 1 of its 7. Cl keeps 3 lone pairs.',
           zh:'H 共用佢 1 粒電子；Cl 共用 7 粒中嘅 1 粒。Cl 保留 3 對孤對。' } },

  { id:'dc-h2o', compound:'H₂O', type:'covalent', tier:2,
    atoms:[
      { sym:'O', x:400, y:220, r:76, lonePairs:2, bondPairs:2 },
      { sym:'H', x:230, y:340, r:58, lonePairs:0, bondPairs:1 },
      { sym:'H', x:570, y:340, r:58, lonePairs:0, bondPairs:1 }
    ], bonds:[{a:0,b:1,pairs:1},{a:0,b:2,pairs:1}],
    hint:{ en:'O has 6 outer electrons: 2 lone pairs + 2 bond pairs (one to each H). Each H shares 1 pair.',
           zh:'O 有 6 粒最外層電子：2 對孤對 + 2 對鍵對（各連一粒 H）。每粒 H 共用 1 對。' } },

  { id:'dc-nh3', compound:'NH₃', type:'covalent', tier:3,
    atoms:[
      { sym:'N', x:400, y:210, r:76, lonePairs:1, bondPairs:3 },
      { sym:'H', x:220, y:330, r:56, lonePairs:0, bondPairs:1 },
      { sym:'H', x:580, y:330, r:56, lonePairs:0, bondPairs:1 },
      { sym:'H', x:400, y:400, r:56, lonePairs:0, bondPairs:1 }
    ], bonds:[{a:0,b:1,pairs:1},{a:0,b:2,pairs:1},{a:0,b:3,pairs:1}],
    hint:{ en:'N has 5 outer electrons: 3 bond pairs + 1 lone pair. Only the bond pairs are shared.',
           zh:'N 有 5 粒最外層電子：3 對鍵對 + 1 對孤對。只有鍵對係共用。' } },

  { id:'dc-ch4', compound:'CH₄', type:'covalent', tier:3,
    atoms:[
      { sym:'C', x:400, y:220, r:74, lonePairs:0, bondPairs:4 },
      { sym:'H', x:240, y:200, r:54, lonePairs:0, bondPairs:1 },
      { sym:'H', x:560, y:200, r:54, lonePairs:0, bondPairs:1 },
      { sym:'H', x:250, y:370, r:54, lonePairs:0, bondPairs:1 },
      { sym:'H', x:550, y:370, r:54, lonePairs:0, bondPairs:1 }
    ], bonds:[{a:0,b:1,pairs:1},{a:0,b:2,pairs:1},{a:0,b:3,pairs:1},{a:0,b:4,pairs:1}],
    hint:{ en:'C has 4 outer electrons and forms 4 bond pairs with 4 H atoms — no lone pairs on C.',
           zh:'C 有 4 粒最外層電子，同 4 粒 H 形成 4 對鍵對 — C 上面冇孤對。' } }
];

/* ---------- glossary ---------- */
const GLOSSARY = [
  { id:'ionic', en:'Ionic bond', zh:'離子鍵',
    def:{ en:'The electrostatic attraction between oppositely charged ions, formed by transfer of electrons from a metal to a non-metal.',
          zh:'由金屬把電子轉移給非金屬後，帶相反電荷的離子之間的靜電吸引力。' } },
  { id:'covalent', en:'Covalent bond', zh:'共價鍵',
    def:{ en:'A bond formed when two atoms share one or more pairs of electrons.',
          zh:'兩粒原子共用一對或多對電子而形成的鍵。' } },
  { id:'metallic', en:'Metallic bond', zh:'金屬鍵',
    def:{ en:'The attraction between a lattice of positive metal ions and a sea of delocalised electrons.',
          zh:'正金屬離子晶格與離域電子海之間的吸引力。' } },
  { id:'delocalised', en:'Delocalised electron', zh:'離域電子',
    def:{ en:'An electron that is not tied to one atom but can move through a structure — this is why metals conduct.',
          zh:'不受單一原子束縛、可在結構中移動的電子 — 金屬之所以導電的原因。' } },
  { id:'cation', en:'Cation', zh:'陽離子',
    def:{ en:'A positively charged ion formed when an atom LOSES electrons. e.g. Na → Na⁺ + e⁻',
          zh:'原子失去電子後形成的帶正電離子。例：Na → Na⁺ + e⁻' } },
  { id:'anion', en:'Anion', zh:'陰離子',
    def:{ en:'A negatively charged ion formed when an atom GAINS electrons. e.g. Cl + e⁻ → Cl⁻',
          zh:'原子得到電子後形成的帶負電離子。例：Cl + e⁻ → Cl⁻' } },
  { id:'lone', en:'Lone pair', zh:'孤對電子',
    def:{ en:'A pair of outer-shell electrons that belongs to one atom only and is NOT shared in a bond.',
          zh:'只屬於一粒原子、並無參與成鍵共用的最外層電子對。' } },
  { id:'bondpair', en:'Bond pair', zh:'鍵對',
    def:{ en:'A pair of electrons shared between two atoms, forming a covalent bond.',
          zh:'兩粒原子之間共用、形成共價鍵的一對電子。' } },
  { id:'octet', en:'Octet rule', zh:'八隅體規則',
    def:{ en:'Atoms tend to gain, lose or share electrons to have 8 electrons in their outer shell (2 for hydrogen).',
          zh:'原子傾向透過得失或共用電子，使最外層有 8 粒電子（氫為 2 粒）。' } },
  { id:'electrostatic', en:'Electrostatic attraction', zh:'靜電吸引',
    def:{ en:'The force of attraction between particles with opposite electrical charges.',
          zh:'帶相反電荷粒子之間的吸引力。' } },
  { id:'lattice', en:'Giant ionic lattice', zh:'巨型離子晶格',
    def:{ en:'A huge 3-D arrangement of alternating positive and negative ions, e.g. in solid NaCl.',
          zh:'正負離子交替排列而成的巨大三維結構，例如固態 NaCl。' } },
  { id:'simplemol', en:'Simple molecular', zh:'簡單分子',
    def:{ en:'A substance made of small molecules held together by weak forces between molecules — low melting point.',
          zh:'由小分子組成、分子間只有微弱作用力的物質 — 熔點低。' } },
  { id:'giantcov', en:'Giant covalent structure', zh:'巨型共價結構',
    def:{ en:'A huge 3-D network of atoms joined by covalent bonds, e.g. diamond — very high melting point.',
          zh:'原子以共價鍵連成巨大三維網絡，例如鑽石 — 熔點極高。' } },
  { id:'electroneg', en:'Dot-and-cross diagram', zh:'點叉圖',
    def:{ en:'A diagram showing ONLY the outer-shell electrons of each atom, using dots for one atom and crosses for the other.',
          zh:'只顯示每粒原子最外層電子的圖，用點代表一方原子、叉代表另一方。' } }
];

/* ---------- interaction nodes ----------
   type: npc | chest | crystal
   main: counts toward the 9 main objectives
*/
const NODES = [
  { id:'n1', type:'npc',     zone:'A', x:0, z:-31, compound:'nacl', main:1, label:{en:'Ion Sage', zh:'離子智者'} },
  { id:'n2', type:'chest',   zone:'A', x:-40, z:-40, dc:'dc-nacl', main:1, label:{en:'Salt Chest', zh:'鹽之寶箱'} },
  { id:'n3', type:'npc',     zone:'B', x: 18, z:-16, compound:'h2',   main:1, label:{en:'Gas Spirit', zh:'氣體精靈'} },
  { id:'n4', type:'npc',     zone:'C', x:-20, z: 16, compound:'fe',   main:1, label:{en:'Forge Keeper', zh:'鍛造守衛'} },
  { id:'n5', type:'npc',     zone:'B', x: 45, z:-35, compound:'h2o',  main:1, label:{en:'Water Nymph', zh:'水之精靈'} },
  { id:'n6', type:'chest',   zone:'B', x: 60, z:-55, dc:'dc-hcl',     main:1, label:{en:'Acid Chest', zh:'酸之寶箱'} },
  { id:'n7', type:'npc',     zone:'B', x: 75, z:-30, compound:'co2',  main:1, label:{en:'Air Wanderer', zh:'空氣旅人'} },
  { id:'n8', type:'chest',   zone:'D', x: 55, z: 55, dc:'dc-ch4',     main:1, label:{en:'Methane Chest', zh:'甲烷寶箱'} },
  { id:'n9', type:'npc',     zone:'D', x: 75, z: 70, compound:'bf3',  main:1, label:{en:'Crystal Scholar', zh:'晶體學者'} },

  { id:'s1', type:'npc',     zone:'A', x:-52, z:-72, compound:'na2o', main:0, label:{en:'Oxide Hermit', zh:'氧化物隱士'} },
  { id:'s2', type:'npc',     zone:'A', x:-84, z:-96, compound:'mgcl2',main:0, label:{en:'Salt Miner', zh:'鹽礦工'} },
  { id:'s3', type:'chest',   zone:'A', x:-80, z:-72, dc:'dc-mgo',     main:0, label:{en:'Magnesia Chest', zh:'鎂之寶箱'} },
  { id:'s4', type:'npc',     zone:'B', x: 52, z:-72, compound:'cl2',  main:0, label:{en:'Green Mist', zh:'綠霧'} },
  { id:'s5', type:'chest',   zone:'B', x: 28, z:-62, dc:'dc-h2o',     main:0, label:{en:'Rain Chest', zh:'雨之寶箱'} },
  { id:'s6', type:'npc',     zone:'C', x:-50, z: 45, compound:'cu',   main:0, label:{en:'Copper Smith', zh:'銅匠'} },
  { id:'s7', type:'npc',     zone:'C', x:-78, z: 78, compound:'al',   main:0, label:{en:'Light Metal', zh:'輕金屬'} },
  { id:'s8', type:'chest',   zone:'D', x: 40, z: 82, dc:'dc-nh3',     main:0, label:{en:'Ammonia Chest', zh:'氨之寶箱'} },
  { id:'s9', type:'npc',     zone:'D', x: 88, z: 88, compound:'nh4cl',main:0, label:{en:'Puzzle Voice', zh:'謎之聲'} },

  { id:'s10',type:'npc',     zone:'B', x: 34, z:-48, compound:'o2',     main:0, label:{en:'Twin Breath', zh:'雙息'} },
  { id:'s11',type:'npc',     zone:'A', x:-70, z:-58, compound:'nh3',    main:0, label:{en:'Sharp Wind', zh:'刺風'} },
  { id:'s12',type:'npc',     zone:'C', x:-92, z: 62, compound:'diamond',main:0, label:{en:'Hard Gem', zh:'硬寶石'} },
  { id:'s13',type:'npc',     zone:'D', x: 66, z: 78, compound:'c60',    main:0, label:{en:'Round Cage', zh:'圓籠'} },

  { id:'g1', type:'guild', zone:'A', x: 11, z:-17, ir:7.5, colliderR:4.6, main:0, label:{en:"Adventurers' Guild", zh:'冒險者公會'} },
  { id:'sh1',type:'shop',  zone:'A', x:-10, z:-18, ir:6.5, colliderR:3.4, main:0, label:{en:'Chem Supply Shop', zh:'化學商店'} },

  { id:'c1', type:'crystal', zone:'A', x:-58, z:-34, term:'cation',      main:0 },
  { id:'c2', type:'crystal', zone:'B', x: 48, z:-76, term:'covalent',    main:0 },
  { id:'c3', type:'crystal', zone:'C', x:-72, z: 58, term:'delocalised', main:0 },
  { id:'c4', type:'crystal', zone:'D', x: 48, z: 86, term:'octet',       main:0 },
  { id:'c5', type:'crystal', zone:'B', x: 80, z:-62, term:'lone',        main:0 },
  { id:'c6', type:'crystal', zone:'D', x: 86, z: 58, term:'giantcov',    main:0 }
];

/* ---------- teleport waypoints ----------
   Placed on the existing travel route (plaza → ionic west → forest east
   → metal pass → crystal cavern) so fast travel removes backtracking
   instead of skipping content.  `start:1` = already active at spawn.
*/
const WAYPOINTS = [
  { id:'wp0', zone:'A', x:   7, z: -11, start:1, name:{ en:'Windvale Gate',   zh:'風谷鎮城門' } },
  { id:'wp1', zone:'A', x: -46, z: -28,           name:{ en:'Saltwatch Post',  zh:'鹽晶哨站' } },
  { id:'wp2', zone:'B', x:  30, z: -30,           name:{ en:'Forest Gate',     zh:'森林入口' } },
  { id:'wp3', zone:'B', x:  68, z: -50,           name:{ en:'Deep Grove',      zh:'密林深處' } },
  { id:'wp4', zone:'C', x: -38, z:  34,           name:{ en:'Forge Pass',      zh:'鍛造隘口' } },
  { id:'wp5', zone:'D', x:  44, z:  42,           name:{ en:'Cavern Mouth',    zh:'晶洞入口' } },
  { id:'wp6', zone:'D', x:  84, z:  66,           name:{ en:'Deep Altar',      zh:'深晶祭壇' } }
];

const MAIN_TOTAL = NODES.filter(n => n.main).length;

/* ============================================================
   COMBAT / REWARD LOOP DATA
   Original designs inspired by action RPGs; no copied characters,
   art or story. All names and models are bespoke to Bond Quest.
   ============================================================ */

/* Weapons. cost/gold = shop price; scoreReq = score gate to buy.
   damage = per-hit; reach = attack radius; rate = min seconds between hits;
   anim = attack animation style consumed by world.js. */
const WEAPONS = [
  { id:'sword',   name:'Bond Blade',      type:'sword',  damage:12, reach:3.4, rate:0.36, anim:'slash',   color:0xdfeaf2, glow:0x8ff0c8, gold:0,   scoreReq:0,   quest:null,  desc:'A balanced one-handed blade. Fast, reliable, easy to combo.' },
  { id:'great',   name:'Ion Cleaver',     type:'great',  damage:26, reach:4.0, rate:0.72, anim:'heavy',   color:0xc9d6e4, glow:0xffc85f, gold:120, scoreReq:40,  quest:'n4',  desc:'Heavy two-handed edge. Slow but hits hard with a wide arc. Forged only after the Forge Keeper\'s metal remembers.' },
  { id:'staff',   name:'Orb Staff',       type:'staff',  damage:16, reach:6.2, rate:0.52, anim:'cast',    color:0xb9a7f0, glow:0x7fd8ff, gold:180, scoreReq:80,  quest:'n4',  desc:'Channels orbital energy. Long range and a radiant burst. Unlocked by the Forge Keeper\'s gratitude.' },
  { id:'bows',    name:'Electron Bow',    type:'bow',    damage:10, reach:9.0, rate:0.30, anim:'shoot',   color:0xe8d9a8, glow:0xffe08a, gold:220, scoreReq:120, quest:null,  desc:'Fires electron bolts from afar. Rapid and precise.' },
  { id:'daggers', name:'Twin Sigils',     type:'daggers',damage:8,  reach:2.8, rate:0.20, anim:'flurry',  color:0xf0c8d8, glow:0xff8fc8, gold:260, scoreReq:180, quest:null,  desc:'Paired blades for a blur of rapid strikes.' }
];

/* Playable characters. role affects stats; scoreReq gates shop unlock;
   skin variants are cosmetic outfits purchasable with gold. */
const CHARACTERS = [
  { id:'lyra',   name:'Elara',      gender:'female', role:'Adventurer',    color:0x343a4d, hair:0x5a3828, speed:1.00, bonus:0,    scoreReq:0,   rarity:4, element:'ember', desc:'A seasoned road-worn adventurer with balanced speed and power.' },
  { id:'kael',   name:'Kael',       gender:'male',   role:'Vanguard',      color:0x6f9fd8, hair:0x2e2a2c, speed:0.92, bonus:0.15, scoreReq:0,   rarity:3, element:'terra', desc:'Burly shield-bearer. Slower, but hits harder.' },
  { id:'mira',   name:'Mira',       gender:'female', role:'Arcane Caster', color:0xb9a7f0, hair:0x8a5a9a, speed:1.05, bonus:-0.05,scoreReq:60,  rarity:5, element:'tide',  desc:'Ranged orbital mage. Quick and nimble.' },
  { id:'dorian', name:'Dorian',     gender:'male',   role:'Ranger',        color:0x8fd8b0, hair:0x7a5230, speed:1.08, bonus:0.05, scoreReq:140, rarity:4, element:'volt',  desc:'Keen-eyed archer. Fast footwork.' },
  { id:'vex',    name:'Vex',        gender:'female', role:'Shadow Dancer', color:0xe08fb8, hair:0x3a2a44, speed:1.12, bonus:0.10, scoreReq:240, rarity:5, element:'shade', desc:'Twin-blade whirlwind. Dangerous up close.' }
];

/* Elemental skills — one per character, bound to the burst (K) button.
   dmgMul scales the burst damage; radius scales the AoE reach multiplier;
   fx names the world.js burst effect (ring colour + bolt pattern). */
const ELEMENTS = {
  ember: { name:'Ember Burst',  en:'Fire burst · burns a wide arc',      zh:'火系爆發 · 燃燒寬弧',    color:0xff8a3c, dmgMul:3.8, radius:2.2 },
  tide:  { name:'Tide Burst',   en:'Water burst · slows everything hit', zh:'水系爆發 · 凍緩命中敵人', color:0x5fd8ff, dmgMul:3.3, radius:2.6, slow:2.5 },
  terra: { name:'Terra Burst',  en:'Earth burst · heavy knockback',      zh:'土系爆發 · 重擊退',      color:0xc8a05a, dmgMul:3.5, radius:1.9, knock:2.2 },
  volt:  { name:'Volt Burst',   en:'Lightning burst · chains to 2 foes', zh:'雷系爆發 · 連鎖 2 敵',   color:0xffe08a, dmgMul:3.0, radius:2.0, chain:2 },
  shade: { name:'Shade Burst',  en:'Shadow burst · drains and heals',    zh:'影系爆發 · 吸血回復',    color:0xc07fe8, dmgMul:3.4, radius:2.1, leech:0.30 }
};

/* Gacha and learning reward tuning. */
const GACHA_RULES = { pityMax:10, challengesPerDraw:2, weights:{ 3:68, 4:27, 5:5 } };
const REWARD_RULES = {
  stepXp:5, stepGold:3,
  perfectXp:30, perfectGold:20, perfectCrystals:1,
  streakAt:3, streakMultiplier:1.5,
  dailyMultiplier:2, autoFillCrystals:1
};

/* Cosmetic skins / outfits. Applied as a colour theme on the character. */
const SKINS = [
  { id:'default',  name:'Field Uniform',    gold:0,   scoreReq:0,   desc:'Standard adventure outfit.' },
  { id:'ember',    name:'Ember Regalia',    gold:100, scoreReq:30,  desc:'Warm crimson and gold accents.' },
  { id:'tide',     name:'Tidekeeper',       gold:160, scoreReq:90,  desc:'Cool ocean blues and silver.' },
  { id:'aurora',   name:'Aurora Silk',      gold:240, scoreReq:160, desc:'Iridescent violet and mint.' },
  { id:'nova',     name:'Nova Plate',       gold:320, scoreReq:260, desc:'Radiant star-forged armour.' }
];

/* Enemies roaming the fields and roads. hp base; score/gold rewards. */
const ENEMY_TYPES = [
  { id:'boar',    name:'Rift Boar',     hp:40,  speed:3.2, damage:8,  score:10, gold:12, color:0x9b6b4a, scale:1.00 },
  { id:'slime',   name:'Gelatinoid',    hp:26,  speed:2.2, damage:5,  score:8,  gold:9,  color:0x6fd8c0, scale:0.80 },
  { id:'crab',    name:'Crystal Crab',  hp:64,  speed:1.8, damage:13, score:18, gold:20, color:0x8b7fd0, scale:1.20 }
];

/* The Rift Tyrant — world boss at the Deep Altar (wp6, zone D).
   Spawns only after every main objective (n1–n9) is complete. */
const BOSS = {
  id:'tyrant', name:'Rift Tyrant', en:'Rift Tyrant', zh:'裂隙暴君',
  hp:420, speed:2.4, damage:22, score:400, gold:300,
  scale:2.6, radius:3.2, x:84, z:70,
  desc:'The broken covenant given form. It waits where the realm\'s bonds frayed first.'
};

/* Party rules — collected companions follow the active character;
   keys 1-5 switch control between owned party members. */
const PARTY_RULES = {
  maxActive: 5, followDist: 2.6, catchUpDist: 7.0,
  aiAttackRange: 3.2, aiDamageMul: 0.55, switchCooldown: 0.8
};

/* Reward tuning. */
const COMBAT_RULES = {
  hitScore: 2,            // score per successful hit
  hitGold: 1,             // gold per successful hit
  comboWindow: 1.2,       // seconds to keep a combo alive
  comboBonus: 0.12,       // damage & score bonus per combo step (capped)
  comboCap: 5,
  skillCost: 0,           // skill has a cooldown instead of resource
  skillCooldown: 6.0,
  respawnDelay: 12.0,     // seconds before a defeated enemy respawns
  enemyCap: 18,           // max simultaneous enemies
  aggroRange: 16,         // distance at which enemies start chasing
  attackRange: 2.6        // enemy melee reach
};
