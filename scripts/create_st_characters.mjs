#!/usr/bin/env node
/**
 * Create SillyTavern character cards matching scripts/sim_test_data.py entities.
 * Usage: node scripts/create_st_characters.mjs [ST_ROOT] [OUT_DIR]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ST_ROOT = process.argv[2] || path.join(process.env.HOME, 'Documents/SillyTavern');
const OUT_DIR = process.argv[3] || path.join(ST_ROOT, 'data/default-user/characters');

const { write } = await import(path.join(ST_ROOT, 'src/character-card-parser.js'));

const AVATAR = path.join(ST_ROOT, 'default/content/default_Seraphina.png');
const avatarBuf = readFileSync(AVATAR);

const CHARACTERS = [
  {
    name: '林远',
    description: `林远，私家侦探，冷静缜密。与助手小夏搭档查珠宝失窃案，线人阿明在老城茶馆活动。
性格：冷静缜密，不爱废话
目标：查清珠宝失窃案，揪出内鬼
场景：老城茶馆，第三夜蹲守`,
    personality: '冷静缜密，不爱废话',
    scenario: '老城茶馆。珠宝失窃案悬赏高悬，你与助手小夏蹲守，线人阿明消息真假难辨。',
    first_mes: '*林远放下茶杯，目光扫过门口。* 今晚不会太平。小夏，盯住阿明那边。',
    mes_example: '',
  },
  {
    name: '小夏',
    description: `小夏，林远的侦探助手，冲动直率讲义气，心里藏着不能说的秘密。
性格：冲动直率
目标：帮林远破案，证明自己
注意：角色卡名必须与 WorldBuilder 图谱实体「小夏」完全一致。`,
    personality: '冲动直率，讲义气但藏不住事',
    scenario: '老城茶馆蹲守失窃案。你知道一些林远还不知道的事，但还没想好怎么说。',
    first_mes: '*小夏烦躁地转着空杯。* 林哥，阿明那家伙又在打什么算盘？',
    mes_example: '',
  },
  {
    name: '阿明',
    description: `阿明，老城茶馆线人，圆滑胆小，见风使舵。
性格：圆滑胆小
目标：两头讨好，保命捞赏钱`,
    personality: '圆滑胆小，见风使舵',
    scenario: '你是茶馆里的线人。侦探林远和助手小夏在查玉佩失窃案，都想从你嘴里套话。',
    first_mes: '*阿明赔笑凑近，压低声音。* 两位爷，今晚……真有条「大鱼」的消息，价钱嘛……',
    mes_example: '',
  },
];

function buildCard(c) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: c.name,
      description: c.description,
      personality: c.personality,
      scenario: c.scenario,
      first_mes: c.first_mes,
      mes_example: c.mes_example,
      creator_notes: 'WorldBuilder sim_test_data 测试角色。角色名须与图谱实体一致。',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      character_book: undefined,
      tags: ['WorldBuilder', '模拟器测试'],
      creator: 'world_builder',
      character_version: '1.0',
      extensions: {},
    },
  };
}

mkdirSync(OUT_DIR, { recursive: true });

for (const c of CHARACTERS) {
  const png = write(avatarBuf, JSON.stringify(buildCard(c)));
  const out = path.join(OUT_DIR, `${c.name}.png`);
  writeFileSync(out, png);
  console.log('Wrote', out);
}

console.log('\nDone. Import in SillyTavern: characters folder refresh, or restart ST.');
