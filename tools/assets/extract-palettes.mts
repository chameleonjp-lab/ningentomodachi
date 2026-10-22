import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {inspectGlb} from '../../src/assets/source.ts';
// Arguments are four local read-only GLBs in black, blue, green, yellow order, then a NEW output path.
const colors=['black','blue','green','yellow'];
const palettes:Record<string,unknown>={};
for (let i=0;i<colors.length;i++) {
 const path=process.argv[i+2],color=colors[i];if(!path||!color)throw new Error('Four source paths required');
 const bytes=readFileSync(path);const inspection=inspectGlb(bytes);
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const armor=gltf.materials.find((m:{name:string})=>m.name.startsWith('01 |'));
 const inlay=gltf.materials.find((m:{name:string})=>m.name.startsWith('04 |'));
 if(!armor||!inlay||inspection.boneCount!==53)throw new Error('Unexpected source');
 palettes[color]={armorRgb:armor.pbrMetallicRoughness.baseColorFactor.slice(0,3),emissiveRgb:inlay.emissiveFactor,inlayBaseRgb:inlay.pbrMetallicRoughness.baseColorFactor.slice(0,3),emissiveStrength:inlay.extensions.KHR_materials_emissive_strength.emissiveStrength,sourceSha256:createHash('sha256').update(bytes).digest('hex')};
}
const output=process.argv[6];if(!output)throw new Error('New output path required');
writeFileSync(output,`// Exact material values from four read-only source GLBs. See source receipt.\nimport type {ActorColor} from '../contracts';\nimport type {VerifiedPalette} from './threeAssetPack';\nexport const SOURCE_PALETTES = ${JSON.stringify(palettes,null,2)} as const satisfies Partial<Record<ActorColor,VerifiedPalette>>;\n`,{flag:'wx'});
