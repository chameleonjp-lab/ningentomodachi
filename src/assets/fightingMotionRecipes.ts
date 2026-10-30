import type {
  FightingRecipeEntry,
  FightingTuple3,
  FightingSourceVertex,
} from '../contracts/fighting';
export interface FightingReadyRealization {
  readonly kind: 'captured-ready0-realization';
  readonly productionQualified: false;
  readonly motionMs: 0;
  readonly sourceSha256: string;
  readonly archiveSha256: string;
  readonly mappingSha256: string;
  readonly calibrationSha256: string;
  readonly pose: FightingRecipeEntry['pose'];
  readonly bones: readonly {
    sourceNodeIndex: number;
    sourceBoneName: string;
    poseName: string;
  }[];
  readonly primitives: readonly {
    primitive: number;
    vertexCount: number;
    triangleCount: number;
    materialName: string;
    sourceMesh: number;
    sourcePrimitive: number;
    sourceSkin: number;
  }[];
  readonly soles: readonly {
    side: 'L' | 'R';
    surfaceId: string;
    members: readonly FightingSourceVertex[];
    footLocalNormal: FightingTuple3;
    target: FightingTuple3;
  }[];
}
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
}
/** Fixed actual captured Ready0. Not a time-varying Ready recipe or anatomical qualification.
 * Pose from native-ready-hold.json; membership/mapping/normal references from pinned source evidence.
 * Evaluating skin must use real source buffers, not archived point coordinates. */
export const FIGHTING_READY_REALIZATION: FightingReadyRealization = freeze({
  kind: 'captured-ready0-realization',
  productionQualified: false,
  motionMs: 0,
  sourceSha256:
    '78113b6f409633a8ae127a0c4cf149e6e0db8a8f023da53693f5976ddeaac37b',
  archiveSha256:
    '9b2a771da042f3c3414bd23090025b41c760d5060bc973e7b70785ec73593661',
  mappingSha256:
    'c86a8bf3fcb67d61bf6358db2d748bc173f95cd7e4868ef3e37e0d835b69e9d4',
  calibrationSha256:
    '6b22d64dcc20a17bb74425587247053a0116b2c40c6528ef0904cc4a7bb49e3d',
  pose: [
    {
      name: 'root',
      position: [0, -0.12300001919269565, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    {
      name: 'pelvis',
      position: [0, 1.1050000190734863, -0.035],
      quaternion: [0.06104853953485687, 0, 0, 0.9981347984218669],
      scale: [1, 1, 1],
    },
    {
      name: 'spine01',
      position: [0, 0.125, 0],
      quaternion: [0.03489949670250097, 0, 0, 0.9993908270190958],
      scale: [1, 1, 1],
    },
    {
      name: 'spine02',
      position: [0, 0.16999995708465576, 0],
      quaternion: [0.02617694830787315, 0, 0, 0.9996573249755573],
      scale: [1, 1, 1],
    },
    {
      name: 'chest',
      position: [0, 0.1700000762939453, 0],
      quaternion: [-0.008726535498373935, 0, 0, 0.9999619230641713],
      scale: [1, 1, 1],
    },
    {
      name: 'neck',
      position: [0, 0.1499999761581421, 0],
      quaternion: [-0.0697564737441253, 0, 0, 0.9975640502598242],
      scale: [1, 1, 1],
    },
    {
      name: 'head',
      position: [0, 0.11000001430511475, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    {
      name: 'clavicleL',
      position: [
        0.04800000786781311, 0.12700007855892181, -7.677002145101142e-9,
      ],
      quaternion: [
        -0.5439006968497393, -0.5198364685710354, -0.4762171407536137,
        0.45514752733203656,
      ],
      scale: [0.9999999403953552, 0.9999998807907104, 1],
    },
    {
      name: 'upper_armL',
      position: [
        9.604399053841917e-9, 0.24324889481067657, -9.333062678251736e-8,
      ],
      quaternion: [
        0.6278853725630372, 0.4957317136055302, 0.15064328608886773,
        -0.5807896069218998,
      ],
      scale: [0.9999999403953552, 0.9999998211860657, 0.9999997019767761],
    },
    {
      name: 'forearmL',
      position: [
        -7.24581852296069e-8, 0.3413223624229431, -2.1610297551433177e-8,
      ],
      quaternion: [
        -0.8153019323132543, -0.27332390611520546, -0.21066969745712463,
        0.46496794607922254,
      ],
      scale: [0.9999999403953552, 0.9999998807907104, 1],
    },
    {
      name: 'handL',
      position: [
        3.98741875073938e-8, 0.2933187186717987, -5.837181848988848e-9,
      ],
      quaternion: [
        0.011362354271113873, -0.007274452596902847, 0.009698010049760342,
        0.999862015247345,
      ],
      scale: [0.9999998807907104, 0.9999998211860657, 0.9999999403953552],
    },
    {
      name: 'finger_0101L',
      position: [
        -0.028169749304652214, 0.06845410168170929, -0.009973105974495411,
      ],
      quaternion: [
        0.46167173981666565, -0.005055205896496773, 0.13106180727481842,
        0.8773006796836853,
      ],
      scale: [1, 1.0000001192092896, 1],
    },
    {
      name: 'finger_0102L',
      position: [
        6.065755897566305e-9, 0.040062349289655685, 1.753845069174531e-8,
      ],
      quaternion: [
        0.6453988552093506, 0.0197586752474308, 0.038597628474235535,
        0.7626140117645264,
      ],
      scale: [1.0000001192092896, 1, 1.0000001192092896],
    },
    {
      name: 'finger_0103L',
      position: [
        -9.753738261508715e-9, 0.03117264062166214, -2.6765167859821304e-8,
      ],
      quaternion: [
        0.2819225490093231, -0.09084280580282211, 0.03931490704417229,
        0.9543173909187317,
      ],
      scale: [0.9999999403953552, 0.9999998211860657, 0.9999998807907104],
    },
    {
      name: 'finger_0201L',
      position: [
        -0.009018674492835999, 0.07254448533058167, -0.005910313688218594,
      ],
      quaternion: [
        0.46943777799606323, -0.00838465429842472, 0.1324463188648224,
        0.8729351758956909,
      ],
      scale: [0.9999998807907104, 1.0000001192092896, 1],
    },
    {
      name: 'finger_0202L',
      position: [
        -1.823344497609014e-8, 0.04516509175300598, 7.632123821821324e-10,
      ],
      quaternion: [
        0.6489192247390747, 0.01771640032529831, 0.03377540037035942,
        0.7599008083343506,
      ],
      scale: [0.9999998807907104, 0.9999999403953552, 0.9999998807907104],
    },
    {
      name: 'finger_0203L',
      position: [3.55746649916e-8, 0.035040874034166336, -1.98214600288793e-8],
      quaternion: [
        0.29414165019989014, -0.07861056178808212, 0.0355362631380558,
        0.9518604278564453,
      ],
      scale: [1, 1.0000001192092896, 1.0000001192092896],
    },
    {
      name: 'finger_0301L',
      position: [
        0.0101323202252388, 0.07663474977016449, -0.0018475516699254513,
      ],
      quaternion: [
        0.4657913148403168, -0.006830157712101936, 0.13179922103881836,
        0.874997615814209,
      ],
      scale: [1, 1, 0.9999999403953552],
    },
    {
      name: 'finger_0302L',
      position: [
        7.009749225517226e-8, 0.042612120509147644, 1.0725257126864562e-8,
      ],
      quaternion: [
        0.6472654938697815, 0.018684163689613342, 0.03602837398648262,
        0.7611834406852722,
      ],
      scale: [1, 0.9999998807907104, 1.0000001192092896],
    },
    {
      name: 'finger_0303L',
      position: [
        -2.5085485688691733e-8, 0.0331040695309639, -1.3974441159803064e-8,
      ],
      quaternion: [
        0.28824323415756226, -0.08431606739759445, 0.03734154999256134,
        0.953106701374054,
      ],
      scale: [1, 0.9999998211860657, 0.9999998807907104],
    },
    {
      name: 'finger_0401L',
      position: [
        0.02928343415260315, 0.08072501420974731, 0.002215237822383642,
      ],
      quaternion: [
        0.45062053203582764, -0.0001897482288768515, 0.12904872000217438,
        0.8833388686180115,
      ],
      scale: [1, 0.9999999403953552, 0.9999999403953552],
    },
    {
      name: 'finger_0402L',
      position: [
        1.4051891206179334e-8, 0.03455379605293274, 7.110364741436115e-9,
      ],
      quaternion: [
        0.6404021382331848, 0.022547703236341476, 0.04562010243535042,
        0.766352117061615,
      ],
      scale: [0.9999998807907104, 0.9999999403953552, 1],
    },
    {
      name: 'finger_0403L',
      position: [
        -1.5769492378581162e-8, 0.02701188251376152, 2.5924512314645654e-8,
      ],
      quaternion: [
        0.26675376296043396, -0.10873232036828995, 0.044261544942855835,
        0.9565880298614502,
      ],
      scale: [1, 0.9999998807907104, 0.9999999403953552],
    },
    {
      name: 'thumb01L',
      position: [
        -0.025249307975172997, 0.02229197882115841, -0.0018782004481181502,
      ],
      quaternion: [
        0.18570992350578308, -0.5049132108688354, 0.283753365278244,
        0.7937622666358948,
      ],
      scale: [0.9999999403953552, 1, 0.9999997615814209],
    },
    {
      name: 'thumb02L',
      position: [
        5.0352799263464476e-8, 0.038794275373220444, -1.6936803959310964e-8,
      ],
      quaternion: [
        0.063089519739151, 0.074149489402771, -0.42784634232521057,
        0.8985928893089294,
      ],
      scale: [1.0000001192092896, 1.0000001192092896, 1.0000001192092896],
    },
    {
      name: 'thumb03L',
      position: [
        4.589987412373375e-8, 0.03312099725008011, -3.610611143400888e-9,
      ],
      quaternion: [
        0.14560149610042572, 0.6061689257621765, -0.4135200083255768,
        0.6635968089103699,
      ],
      scale: [1, 1.0000001192092896, 1],
    },
    {
      name: 'clavicleR',
      position: [
        -0.04800000786781311, 0.12700007855892181, -7.677002145101142e-9,
      ],
      quaternion: [
        -0.5439006968497393, 0.5198364685710354, 0.4762171407536137,
        0.45514752733203656,
      ],
      scale: [0.9999999403953552, 0.9999998807907104, 1],
    },
    {
      name: 'upper_armR',
      position: [
        -9.604399053841917e-9, 0.24324889481067657, -9.333062678251736e-8,
      ],
      quaternion: [
        0.6082622829046478, -0.3871740379711657, -0.22163731337556364,
        -0.6564983632435331,
      ],
      scale: [0.9999999403953552, 0.9999998211860657, 0.9999997615814209],
    },
    {
      name: 'forearmR',
      position: [
        7.59284972673413e-8, 0.3413223624229431, -1.351154743645111e-8,
      ],
      quaternion: [
        -0.8845217657957866, 0.2842450740904605, 0.24354896964461473,
        0.27840595250871664,
      ],
      scale: [0.9999999403953552, 0.9999999403953552, 0.9999997615814209],
    },
    {
      name: 'handR',
      position: [
        -4.749556126171228e-8, 0.2933189272880554, -2.723021363948419e-9,
      ],
      quaternion: [
        0.011362355202436447, 0.007274441421031952, -0.009698006324470043,
        0.999862015247345,
      ],
      scale: [0.9999999403953552, 0.9999997615814209, 0.9999998211860657],
    },
    {
      name: 'finger_0101R',
      position: [
        0.028169769793748856, 0.06845439225435257, -0.009973052889108658,
      ],
      quaternion: [
        0.46167171001434326, 0.005055242218077183, -0.13106179237365723,
        0.8773007392883301,
      ],
      scale: [1.0000001192092896, 1, 1],
    },
    {
      name: 'finger_0102R',
      position: [
        9.926212074518048e-10, 0.040062375366687775, 1.0816004092362164e-8,
      ],
      quaternion: [
        0.6453988552093506, -0.019758697599172592, -0.03859764710068703,
        0.7626140713691711,
      ],
      scale: [1.0000001192092896, 1, 1],
    },
    {
      name: 'finger_0103R',
      position: [
        -1.0291669738649034e-8, 0.031172670423984528, 2.1699001706565468e-8,
      ],
      quaternion: [
        0.28192251920700073, 0.09084279090166092, -0.039314888417720795,
        0.9543173909187317,
      ],
      scale: [1, 0.9999999403953552, 1],
    },
    {
      name: 'finger_0201R',
      position: [
        0.009018708020448685, 0.07254467159509659, -0.005910282023251057,
      ],
      quaternion: [
        0.46943777799606323, 0.00838464219123125, -0.13244633376598358,
        0.8729351758956909,
      ],
      scale: [1, 1, 1],
    },
    {
      name: 'finger_0202R',
      position: [
        6.269282692983325e-8, 0.04516514018177986, 1.6219144916007622e-9,
      ],
      quaternion: [
        0.6489192247390747, -0.01771637611091137, -0.03377539664506912,
        0.7599008083343506,
      ],
      scale: [0.9999998807907104, 1, 0.9999998807907104],
    },
    {
      name: 'finger_0203R',
      position: [
        9.600490180616816e-9, 0.035040926188230515, -5.162460237073674e-9,
      ],
      quaternion: [
        0.2941417098045349, 0.07861055433750153, -0.0355362705886364,
        0.9518604278564453,
      ],
      scale: [1, 0.9999999403953552, 1],
    },
    {
      name: 'finger_0301R',
      position: [
        -0.01013239100575447, 0.07663507014513016, -0.0018475266406312585,
      ],
      quaternion: [
        0.4657912254333496, 0.006830183323472738, -0.13179925084114075,
        0.874997615814209,
      ],
      scale: [1.0000001192092896, 1, 1],
    },
    {
      name: 'finger_0302R',
      position: [
        -1.3423368727671914e-7, 0.042611949145793915, 9.986156346286634e-10,
      ],
      quaternion: [
        0.6472654938697815, -0.018684180453419685, -0.03602837026119232,
        0.7611834406852722,
      ],
      scale: [1, 0.9999998807907104, 1],
    },
    {
      name: 'finger_0303R',
      position: [
        3.453439489931043e-8, 0.033104121685028076, 1.0524842330994488e-8,
      ],
      quaternion: [
        0.28824320435523987, 0.08431608229875565, -0.03734154254198074,
        0.953106701374054,
      ],
      scale: [0.9999999403953552, 0.9999997615814209, 0.9999998211860657],
    },
    {
      name: 'finger_0401R',
      position: [
        -0.029283467680215836, 0.08072540909051895, 0.0022152685560286045,
      ],
      quaternion: [
        0.45062053203582764, 0.00018977564468514174, -0.12904872000217438,
        0.8833388686180115,
      ],
      scale: [1, 1, 0.9999998807907104],
    },
    {
      name: 'finger_0402R',
      position: [
        1.81475563465483e-8, 0.03455369174480438, -1.6905694621982548e-8,
      ],
      quaternion: [
        0.6404021382331848, -0.02254769764840603, -0.04562010616064072,
        0.766352117061615,
      ],
      scale: [0.9999998807907104, 1, 0.9999998807907104],
    },
    {
      name: 'finger_0403R',
      position: [
        8.639707260726937e-8, 0.02701188623905182, -4.688386923135113e-8,
      ],
      quaternion: [
        0.26675382256507874, 0.10873229056596756, -0.04426155611872673,
        0.9565880298614502,
      ],
      scale: [1, 1, 1],
    },
    {
      name: 'thumb01R',
      position: [
        0.02524927631020546, 0.022292226552963257, -0.0018781479448080063,
      ],
      quaternion: [
        0.18570992350578308, 0.5049132704734802, -0.283753365278244,
        0.79376220703125,
      ],
      scale: [1, 1, 1],
    },
    {
      name: 'thumb02R',
      position: [
        1.7023021214868095e-8, 0.038794420659542084, -7.086664144395627e-9,
      ],
      quaternion: [
        0.0630895122885704, -0.07414951920509338, 0.4278463125228882,
        0.8985928893089294,
      ],
      scale: [1.000000238418579, 1.0000001192092896, 1.0000001192092896],
    },
    {
      name: 'thumb03R',
      position: [
        3.005461479688165e-8, 0.033121079206466675, -3.193905229181837e-8,
      ],
      quaternion: [
        0.14560149610042572, -0.6061689257621765, 0.4135200083255768,
        0.6635968089103699,
      ],
      scale: [1, 1, 0.9999999403953552],
    },
    {
      name: 'thighL',
      position: [
        0.1550000011920929, 1.9749649027289706e-8, -0.009000000543892384,
      ],
      quaternion: [
        0.918783392008837, 0.024359765352811532, 0.010253113493649211,
        0.3938763182324852,
      ],
      scale: [1.0000008344650269, 0.9999997019767761, 1.0000008344650269],
    },
    {
      name: 'shinL',
      position: [
        2.4992072411578192e-8, 0.49066081643104553, 2.139446175775106e-9,
      ],
      quaternion: [
        0.43832762170720946, -0.0075884997119670585, 0.02430146056734731,
        0.898454643749608,
      ],
      scale: [1, 1, 1],
    },
    {
      name: 'footL',
      position: [
        -1.7975981592144308e-8, 0.4472528398036957, -1.327436383036229e-8,
      ],
      quaternion: [
        -0.5730888435883246, -0.0015265943331340725, 0.00029660513652838855,
        0.8194917686574484,
      ],
      scale: [0.9999998807907104, 0.9999998807907104, 0.9999999403953552],
    },
    {
      name: 'toeL',
      position: [
        -6.434192068027755e-10, 0.17226137220859528, -3.4546010496683266e-10,
      ],
      quaternion: [
        -0.14768241345882416, 2.3027726392399472e-9, 3.438224149832081e-10,
        0.9890348315238953,
      ],
      scale: [1, 1, 1],
    },
    {
      name: 'thighR',
      position: [
        -0.1550000011920929, 1.9749649027289706e-8, -0.009000000543892384,
      ],
      quaternion: [
        0.9772728965653489, -0.021940653103062847, -0.01473512331292628,
        0.21033109499343325,
      ],
      scale: [1.0000008344650269, 0.9999997019767761, 1.0000008344650269],
    },
    {
      name: 'shinR',
      position: [
        -2.4992072411578192e-8, 0.49066081643104553, 2.139446175775106e-9,
      ],
      quaternion: [
        0.4723974462716272, 0.006612029906633296, -0.0246860245545983,
        0.8810150572768702,
      ],
      scale: [1, 1, 1],
    },
    {
      name: 'footR',
      position: [
        1.7975981592144308e-8, 0.4472528398036957, -1.327436383036229e-8,
      ],
      quaternion: [
        -0.7456876015815429, 0.0015539387282912703, 6.123427258691253e-5,
        0.6662939159216316,
      ],
      scale: [0.9999998807907104, 0.9999998807907104, 0.9999999403953552],
    },
    {
      name: 'toeR',
      position: [
        6.434192068027755e-10, 0.17226137220859528, -3.4546010496683266e-10,
      ],
      quaternion: [
        -0.14768241345882416, -2.3027726392399472e-9, -3.438224149832081e-10,
        0.9890348315238953,
      ],
      scale: [1, 1, 1],
    },
  ],
  bones: [
    {
      sourceNodeIndex: 52,
      sourceBoneName: 'root',
      poseName: 'root',
    },
    {
      sourceNodeIndex: 51,
      sourceBoneName: 'pelvis',
      poseName: 'pelvis',
    },
    {
      sourceNodeIndex: 42,
      sourceBoneName: 'spine.01',
      poseName: 'spine01',
    },
    {
      sourceNodeIndex: 41,
      sourceBoneName: 'spine.02',
      poseName: 'spine02',
    },
    {
      sourceNodeIndex: 40,
      sourceBoneName: 'chest',
      poseName: 'chest',
    },
    {
      sourceNodeIndex: 1,
      sourceBoneName: 'neck',
      poseName: 'neck',
    },
    {
      sourceNodeIndex: 0,
      sourceBoneName: 'head',
      poseName: 'head',
    },
    {
      sourceNodeIndex: 20,
      sourceBoneName: 'clavicle.L',
      poseName: 'clavicleL',
    },
    {
      sourceNodeIndex: 19,
      sourceBoneName: 'upper_arm.L',
      poseName: 'upper_armL',
    },
    {
      sourceNodeIndex: 18,
      sourceBoneName: 'forearm.L',
      poseName: 'forearmL',
    },
    {
      sourceNodeIndex: 17,
      sourceBoneName: 'hand.L',
      poseName: 'handL',
    },
    {
      sourceNodeIndex: 4,
      sourceBoneName: 'finger_01.01.L',
      poseName: 'finger_0101L',
    },
    {
      sourceNodeIndex: 3,
      sourceBoneName: 'finger_01.02.L',
      poseName: 'finger_0102L',
    },
    {
      sourceNodeIndex: 2,
      sourceBoneName: 'finger_01.03.L',
      poseName: 'finger_0103L',
    },
    {
      sourceNodeIndex: 7,
      sourceBoneName: 'finger_02.01.L',
      poseName: 'finger_0201L',
    },
    {
      sourceNodeIndex: 6,
      sourceBoneName: 'finger_02.02.L',
      poseName: 'finger_0202L',
    },
    {
      sourceNodeIndex: 5,
      sourceBoneName: 'finger_02.03.L',
      poseName: 'finger_0203L',
    },
    {
      sourceNodeIndex: 10,
      sourceBoneName: 'finger_03.01.L',
      poseName: 'finger_0301L',
    },
    {
      sourceNodeIndex: 9,
      sourceBoneName: 'finger_03.02.L',
      poseName: 'finger_0302L',
    },
    {
      sourceNodeIndex: 8,
      sourceBoneName: 'finger_03.03.L',
      poseName: 'finger_0303L',
    },
    {
      sourceNodeIndex: 13,
      sourceBoneName: 'finger_04.01.L',
      poseName: 'finger_0401L',
    },
    {
      sourceNodeIndex: 12,
      sourceBoneName: 'finger_04.02.L',
      poseName: 'finger_0402L',
    },
    {
      sourceNodeIndex: 11,
      sourceBoneName: 'finger_04.03.L',
      poseName: 'finger_0403L',
    },
    {
      sourceNodeIndex: 16,
      sourceBoneName: 'thumb.01.L',
      poseName: 'thumb01L',
    },
    {
      sourceNodeIndex: 15,
      sourceBoneName: 'thumb.02.L',
      poseName: 'thumb02L',
    },
    {
      sourceNodeIndex: 14,
      sourceBoneName: 'thumb.03.L',
      poseName: 'thumb03L',
    },
    {
      sourceNodeIndex: 39,
      sourceBoneName: 'clavicle.R',
      poseName: 'clavicleR',
    },
    {
      sourceNodeIndex: 38,
      sourceBoneName: 'upper_arm.R',
      poseName: 'upper_armR',
    },
    {
      sourceNodeIndex: 37,
      sourceBoneName: 'forearm.R',
      poseName: 'forearmR',
    },
    {
      sourceNodeIndex: 36,
      sourceBoneName: 'hand.R',
      poseName: 'handR',
    },
    {
      sourceNodeIndex: 23,
      sourceBoneName: 'finger_01.01.R',
      poseName: 'finger_0101R',
    },
    {
      sourceNodeIndex: 22,
      sourceBoneName: 'finger_01.02.R',
      poseName: 'finger_0102R',
    },
    {
      sourceNodeIndex: 21,
      sourceBoneName: 'finger_01.03.R',
      poseName: 'finger_0103R',
    },
    {
      sourceNodeIndex: 26,
      sourceBoneName: 'finger_02.01.R',
      poseName: 'finger_0201R',
    },
    {
      sourceNodeIndex: 25,
      sourceBoneName: 'finger_02.02.R',
      poseName: 'finger_0202R',
    },
    {
      sourceNodeIndex: 24,
      sourceBoneName: 'finger_02.03.R',
      poseName: 'finger_0203R',
    },
    {
      sourceNodeIndex: 29,
      sourceBoneName: 'finger_03.01.R',
      poseName: 'finger_0301R',
    },
    {
      sourceNodeIndex: 28,
      sourceBoneName: 'finger_03.02.R',
      poseName: 'finger_0302R',
    },
    {
      sourceNodeIndex: 27,
      sourceBoneName: 'finger_03.03.R',
      poseName: 'finger_0303R',
    },
    {
      sourceNodeIndex: 32,
      sourceBoneName: 'finger_04.01.R',
      poseName: 'finger_0401R',
    },
    {
      sourceNodeIndex: 31,
      sourceBoneName: 'finger_04.02.R',
      poseName: 'finger_0402R',
    },
    {
      sourceNodeIndex: 30,
      sourceBoneName: 'finger_04.03.R',
      poseName: 'finger_0403R',
    },
    {
      sourceNodeIndex: 35,
      sourceBoneName: 'thumb.01.R',
      poseName: 'thumb01R',
    },
    {
      sourceNodeIndex: 34,
      sourceBoneName: 'thumb.02.R',
      poseName: 'thumb02R',
    },
    {
      sourceNodeIndex: 33,
      sourceBoneName: 'thumb.03.R',
      poseName: 'thumb03R',
    },
    {
      sourceNodeIndex: 46,
      sourceBoneName: 'thigh.L',
      poseName: 'thighL',
    },
    {
      sourceNodeIndex: 45,
      sourceBoneName: 'shin.L',
      poseName: 'shinL',
    },
    {
      sourceNodeIndex: 44,
      sourceBoneName: 'foot.L',
      poseName: 'footL',
    },
    {
      sourceNodeIndex: 43,
      sourceBoneName: 'toe.L',
      poseName: 'toeL',
    },
    {
      sourceNodeIndex: 50,
      sourceBoneName: 'thigh.R',
      poseName: 'thighR',
    },
    {
      sourceNodeIndex: 49,
      sourceBoneName: 'shin.R',
      poseName: 'shinR',
    },
    {
      sourceNodeIndex: 48,
      sourceBoneName: 'foot.R',
      poseName: 'footR',
    },
    {
      sourceNodeIndex: 47,
      sourceBoneName: 'toe.R',
      poseName: 'toeR',
    },
  ],
  primitives: [
    {
      primitive: 0,
      vertexCount: 12920,
      triangleCount: 15084,
      materialName: '02 | Graphite mechanical frame',
      sourceMesh: 0,
      sourcePrimitive: 0,
      sourceSkin: 0,
    },
    {
      primitive: 1,
      vertexCount: 2963,
      triangleCount: 3348,
      materialName: '05 | Flexible joint seals',
      sourceMesh: 0,
      sourcePrimitive: 1,
      sourceSkin: 0,
    },
    {
      primitive: 2,
      vertexCount: 12462,
      triangleCount: 13000,
      materialName: '03 | Brushed titanium joints',
      sourceMesh: 0,
      sourcePrimitive: 2,
      sourceSkin: 0,
    },
    {
      primitive: 3,
      vertexCount: 13078,
      triangleCount: 10438,
      materialName: '01 | Pearl ceramic armor',
      sourceMesh: 0,
      sourcePrimitive: 3,
      sourceSkin: 0,
    },
    {
      primitive: 4,
      vertexCount: 4758,
      triangleCount: 5328,
      materialName: '04 | Cyan emissive inlays',
      sourceMesh: 0,
      sourcePrimitive: 4,
      sourceSkin: 0,
    },
  ],
  soles: [
    {
      side: 'L',
      surfaceId: 'r2.source.sole36.L',
      members: [
        {
          primitive: 1,
          vertexIndex: 1787,
        },
        {
          primitive: 1,
          vertexIndex: 1788,
        },
        {
          primitive: 1,
          vertexIndex: 1789,
        },
        {
          primitive: 1,
          vertexIndex: 1790,
        },
        {
          primitive: 1,
          vertexIndex: 1791,
        },
        {
          primitive: 1,
          vertexIndex: 1796,
        },
        {
          primitive: 1,
          vertexIndex: 1797,
        },
        {
          primitive: 1,
          vertexIndex: 1798,
        },
        {
          primitive: 1,
          vertexIndex: 1799,
        },
        {
          primitive: 1,
          vertexIndex: 1866,
        },
        {
          primitive: 1,
          vertexIndex: 1867,
        },
        {
          primitive: 1,
          vertexIndex: 1868,
        },
        {
          primitive: 1,
          vertexIndex: 1869,
        },
        {
          primitive: 1,
          vertexIndex: 1870,
        },
        {
          primitive: 1,
          vertexIndex: 1877,
        },
        {
          primitive: 1,
          vertexIndex: 1878,
        },
        {
          primitive: 1,
          vertexIndex: 1879,
        },
        {
          primitive: 1,
          vertexIndex: 1880,
        },
        {
          primitive: 1,
          vertexIndex: 1957,
        },
        {
          primitive: 1,
          vertexIndex: 1958,
        },
        {
          primitive: 1,
          vertexIndex: 1959,
        },
        {
          primitive: 1,
          vertexIndex: 1960,
        },
        {
          primitive: 1,
          vertexIndex: 1966,
        },
        {
          primitive: 1,
          vertexIndex: 1967,
        },
        {
          primitive: 1,
          vertexIndex: 1968,
        },
        {
          primitive: 1,
          vertexIndex: 1969,
        },
        {
          primitive: 1,
          vertexIndex: 1970,
        },
        {
          primitive: 1,
          vertexIndex: 2025,
        },
        {
          primitive: 1,
          vertexIndex: 2026,
        },
        {
          primitive: 1,
          vertexIndex: 2027,
        },
        {
          primitive: 1,
          vertexIndex: 2028,
        },
        {
          primitive: 1,
          vertexIndex: 2035,
        },
        {
          primitive: 1,
          vertexIndex: 2036,
        },
        {
          primitive: 1,
          vertexIndex: 2037,
        },
        {
          primitive: 1,
          vertexIndex: 2038,
        },
        {
          primitive: 1,
          vertexIndex: 2039,
        },
      ],
      footLocalNormal: [
        -2.6288266033366073e-8, 0.5398774328036855, 0.8417436412287602,
      ],
      target: [0.17400019999999997, 0.146, 0.17],
    },
    {
      side: 'R',
      surfaceId: 'r2.source.sole36.R',
      members: [
        {
          primitive: 1,
          vertexIndex: 2656,
        },
        {
          primitive: 1,
          vertexIndex: 2657,
        },
        {
          primitive: 1,
          vertexIndex: 2658,
        },
        {
          primitive: 1,
          vertexIndex: 2659,
        },
        {
          primitive: 1,
          vertexIndex: 2660,
        },
        {
          primitive: 1,
          vertexIndex: 2665,
        },
        {
          primitive: 1,
          vertexIndex: 2666,
        },
        {
          primitive: 1,
          vertexIndex: 2667,
        },
        {
          primitive: 1,
          vertexIndex: 2668,
        },
        {
          primitive: 1,
          vertexIndex: 2735,
        },
        {
          primitive: 1,
          vertexIndex: 2736,
        },
        {
          primitive: 1,
          vertexIndex: 2737,
        },
        {
          primitive: 1,
          vertexIndex: 2738,
        },
        {
          primitive: 1,
          vertexIndex: 2739,
        },
        {
          primitive: 1,
          vertexIndex: 2746,
        },
        {
          primitive: 1,
          vertexIndex: 2747,
        },
        {
          primitive: 1,
          vertexIndex: 2748,
        },
        {
          primitive: 1,
          vertexIndex: 2749,
        },
        {
          primitive: 1,
          vertexIndex: 2826,
        },
        {
          primitive: 1,
          vertexIndex: 2827,
        },
        {
          primitive: 1,
          vertexIndex: 2828,
        },
        {
          primitive: 1,
          vertexIndex: 2829,
        },
        {
          primitive: 1,
          vertexIndex: 2835,
        },
        {
          primitive: 1,
          vertexIndex: 2836,
        },
        {
          primitive: 1,
          vertexIndex: 2837,
        },
        {
          primitive: 1,
          vertexIndex: 2838,
        },
        {
          primitive: 1,
          vertexIndex: 2839,
        },
        {
          primitive: 1,
          vertexIndex: 2894,
        },
        {
          primitive: 1,
          vertexIndex: 2895,
        },
        {
          primitive: 1,
          vertexIndex: 2896,
        },
        {
          primitive: 1,
          vertexIndex: 2897,
        },
        {
          primitive: 1,
          vertexIndex: 2904,
        },
        {
          primitive: 1,
          vertexIndex: 2905,
        },
        {
          primitive: 1,
          vertexIndex: 2906,
        },
        {
          primitive: 1,
          vertexIndex: 2907,
        },
        {
          primitive: 1,
          vertexIndex: 2908,
        },
      ],
      footLocalNormal: [
        2.6288266033366073e-8, 0.5398774328036855, 0.8417436412287602,
      ],
      target: [-0.17399989999999999, 0.146, -0.18],
    },
  ],
});
export const FIGHTING_READY_REALIZATION_DATA_SHA256 =
  '3fb88aaa26012e56f8a3533358cd3966fce392a4f6e2a23e102c1c67a833b579';
