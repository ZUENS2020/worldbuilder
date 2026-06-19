"""雾港·黎氏庄园 — 悬疑封闭局示例图谱(暴雨孤岛 + 遗产疑云)。

场景:家主黎崇山三日前在书房离奇暴毙,被定为「心疾自然死亡」。今夜暴雨封岛,
全族被困庄园,律师将当众宣读遗嘱。但一份据传被家主临终前重立的「真遗嘱」下落不明,
死因鉴定也尚无定论——8 名角色各揣秘密,在继承、清白与旧账之间彼此撕扯。

关系网刻意密布 enemy / rival / 低权重 ally + 多条私有秘密,适合反复跑 tick / 推演结算。

三个预设「悬决事件」(status=pending + stakes + due_tick)是推演引擎的考点:
角色围绕它们博弈,到因果成熟或截止时由 ai_resolve_event 按世界状态结算,落下不可逆后果。
  - 遗嘱宣读(今夜,due_tick=6)——谁掌控庄园
  - 真遗嘱浮现(due_tick=10)——颠覆全局的变量
  - 死因鉴定结论(due_tick=12)——自然死 or 他杀,牵动保险与刑责

推荐模拟器配置(导入后新建模拟时可在 UI 调整,或参考下方 SIM_CONFIG):
  - pending_max_age: 10
  - scheduler_mix_conflict: True(撮合对抗)
  - nudge_strategy: weighted
  - generate_events: True
  - max_encounters_per_tick: 4
  - stability_window: 4（世界入稳态即自动落幕暂停）, max_ticks: 60（兜底）

导入:
  cd scripts && python3 import_world.py manor_mystery_data
"""

PROJECT = {
    "name": "雾港·黎氏庄园",
    "description": (
        "暴雨封岛之夜,家主黎崇山的死亡疑云笼罩黎氏庄园:遗嘱待宣、真遗嘱失踪、"
        "死因未定。8 名角色、5 处场景、家族派系与外来调查者交锋,多条私密秘密交织。"
        "专为关系演化 / 推演结算 / 信念层 / 事件结晶联调设计。"
    ),
    "settings": {
        "graph_hops": {
            "transform_expand": 1,
            "transform_enemy": 2,
            "ai_context": 2,
            "context_injection": 2,
            "isolate_subgraph": 2,
        },
    },
}

# 导入脚本不读取此常量;前端新建模拟时对齐此预设。
DRIVER_MODE = "hybrid"

SIM_CONFIG = {
    "max_encounters_per_tick": 4,
    "scheduler_strategy": "weighted",
    "scheduler_mix_conflict": True,
    "generate_events": True,
    "event_min_significance": 0.6,
    "event_dedupe": True,
    "tick_interval_sec": 8,
    "nudge_strategy": "weighted",
    "nudge_every_n_ticks": 2,
    "nudge_targets_per_tick": 2,
    "nudge_intensity": 0.6,
    # 推演: outcomes from world state; pending_max_age is robustness only.
    "pending_max_age": 10,
    # 落幕: 世界进入稳态(连续 N tick 无实质进展)即自动暂停;max_ticks 兜底。
    "stability_window": 4,
    "max_ticks": 60,
}

ENTITIES: dict[str, dict] = {
    # ── 角色 ─────────────────────────────────────────────────────
    "yanqiu": {
        "name": "黎砚秋",
        "type": "character",
        "properties": {
            "personality": "冷静强势,惯于掌控全局,把柔软藏在公事公办之下",
            "goal": "接掌黎氏产业,压下死因疑云,绝不让庶出的程晚分走一寸",
            "occupation": "长女 / 黎氏集团代理总裁",
            "mood": "克制的紧绷",
            "secret": "父亲死前一周曾对她说要重立遗嘱、给程晚正名;她当时拂袖而去,此事无人知晓",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "zhao": {
        "name": "黎昭",
        "type": "character",
        "properties": {
            "personality": "玩世不恭,缺钱时谄媚、得意时刻薄,擅长把责任推给别人",
            "goal": "在债主找上岛前,尽快拿到足够还赌债的那份遗产",
            "occupation": "次子 / 名义上的董事,实则赋闲",
            "mood": "焦躁而强作镇定",
            "secret": "欠下高利贷,父亲暴毙当夜他正偷偷潜入书房想拿现金,见过当时书房的样子",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "suman": {
        "name": "苏曼",
        "type": "character",
        "properties": {
            "personality": "温婉得体,危机时反应极快,惯用示弱化解敌意",
            "goal": "保住婚前协议约定的份额,撑过今夜不被翻出旧账",
            "occupation": "黎崇山的年轻续弦(遗孀)",
            "mood": "强装哀戚",
            "secret": "婚前协议写明:若证实她婚内出轨则净身出户——而她确与他人有染",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "zhoubo": {
        "name": "周伯",
        "type": "character",
        "properties": {
            "personality": "沉默忠厚,守旧重诺,认死理只认老主人的意思",
            "goal": "完成老主人真正的遗愿,守住黎家最后的体面",
            "occupation": "黎氏庄园老管家(侍奉黎家四十年)",
            "mood": "悲恸而执拗",
            "secret": "老主人临终前把重立的『真遗嘱』封缄交他保管,嘱他『时机到了再拿出来』,现藏于阁楼",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "guming": {
        "name": "顾明哲",
        "type": "character",
        "properties": {
            "personality": "谨慎世故,擅长用专业术语回避追问,怕事但有底线",
            "goal": "让死亡定性停在『自然死』,不让自己卷进任何鉴定纠纷",
            "occupation": "黎家私人医生 / 死亡证明签署者",
            "mood": "心虚的镇定",
            "secret": "签证明时已察觉死者瞳孔与体征不像单纯心疾,疑似中毒,但被人施压草草定案",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "chenlv": {
        "name": "陈律",
        "type": "character",
        "properties": {
            "personality": "圆滑精算,凡事先掂量责任与代价,翻脸只在利益临界点",
            "goal": "今夜把『现有遗嘱』顺利宣读执行,撇清自己,绝不让另一份冒出来",
            "occupation": "黎氏家族遗产执行律师",
            "mood": "职业性的从容",
            "secret": "曾收一笔钱,承诺『让老主人后来重立的那份遗嘱不会出现』,如今寝食难安",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "linsu": {
        "name": "林夙",
        "type": "character",
        "properties": {
            "personality": "冷峭敏锐,问话像手术刀,不动声色地收集每个人的破绽",
            "goal": "查清黎崇山究竟是病死还是被害——结论直接决定巨额保险是否赔付",
            "occupation": "保险公司外聘调查员(以吊唁名义入岛)",
            "mood": "克制的锐利",
            "secret": "她真正的雇主并非保险公司,而是暗中委托她查明真相的某位黎家人",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "chengwan": {
        "name": "程晚",
        "type": "character",
        "properties": {
            "personality": "安静隐忍,看似怯弱实则极有耐心,关键处寸步不让",
            "goal": "让自己作为黎崇山亲生女的身份被承认,拿回父亲允诺的名分",
            "occupation": "不速之客 / 自称黎崇山流落在外的私生女",
            "mood": "孤注一掷的平静",
            "secret": "随身带着黎崇山亲笔信与一枚旧怀表,足以佐证血缘;她在等最稳妥的时机出示",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    # ── 组织 / 地点 ──────────────────────────────────────────────
    "lifamily": {
        "name": "黎氏家族",
        "type": "faction",
        "properties": {
            "description": "雾港首屈一指的航运家族,产业与声望系于家主一身;家主新丧,继承未定,内部已现裂痕。",
        },
    },
    "study": {
        "name": "书房",
        "type": "location",
        "properties": {
            "description": "黎崇山暴毙之处,门窗当夜紧闭。茶几上残留半杯凉茶,保险柜被人动过的痕迹尚未抹净。",
        },
    },
    "hall": {
        "name": "大厅",
        "type": "location",
        "properties": {
            "description": "庄园正厅,黑纱低垂。今夜遗嘱将在此当众宣读,长桌一端摆着家主遗像。",
        },
    },
    "attic": {
        "name": "阁楼",
        "type": "location",
        "properties": {
            "description": "堆满旧物的顶层,常年上锁,钥匙只在管家手里。雨声在此格外清晰。",
        },
    },
    "pier": {
        "name": "码头",
        "type": "location",
        "properties": {
            "description": "通往岛外的唯一渡口。暴雨封航,缆绳空荡——今夜无人能离开,也无人能进来。",
        },
    },
    # ── 预设悬决事件(推演引擎考点)──────────────────────────────
    "will_reading": {
        "name": "遗嘱宣读",
        "type": "event",
        "properties": {
            "description": "今夜大厅当众宣读黎崇山遗嘱,确定产业与名分归属;封岛之下,全员到场。",
            "time": "今夜",
            "status": "pending",
            "stakes": "现有遗嘱一旦宣读生效,黎砚秋掌控全局、苏曼保住份额;程晚将彻底出局,黎昭所得难抵赌债。",
            "due_tick": 6,
            "sequence_order": 1,
            "participant_names": ["黎砚秋", "黎昭", "苏曼", "陈律", "程晚", "周伯"],
        },
    },
    "true_will": {
        "name": "真遗嘱浮现",
        "type": "event",
        "properties": {
            "description": "传闻黎崇山临终前重立了一份遗嘱并秘密托付他人;它若现身,将推翻今夜的一切安排。",
            "time": "未定",
            "status": "pending",
            "stakes": "真遗嘱一旦出示并被采信,继承格局彻底反转,陈律的违约与相关者的隐瞒同时暴露。",
            "due_tick": 10,
            "sequence_order": 2,
            "participant_names": ["周伯", "陈律", "黎砚秋", "程晚"],
        },
    },
    "cause_verdict": {
        "name": "死因鉴定结论",
        "type": "event",
        "properties": {
            "description": "林夙以保险调查之名重启对死因的查证;封岛之内,物证与口供都在收束。",
            "time": "数日内",
            "status": "pending",
            "stakes": "若定为他杀,巨额保险拒赔、刑责临头、凶手出局;若坐实自然死,则掩盖者得以脱身。",
            "due_tick": 12,
            "sequence_order": 3,
            "participant_names": ["林夙", "顾明哲", "黎昭", "苏曼", "黎砚秋"],
        },
    },
}

RELATIONS: list = [
    # ── 家族内核心矛盾 ──────────────────────────────────────────
    ("yanqiu", "zhao", "rival", 0.3, {"description": "姐弟争产,长女嫌弃次子败家,次子怨长女独揽"}),
    ("yanqiu", "suman", "enemy", 0.24, {"description": "长女视年轻继母为外人与威胁"}),
    ("yanqiu", "chengwan", "enemy", 0.18, {"description": "绝不承认这个突然出现的『私生女』"}),
    ("zhao", "suman", "ally", 0.5, {"description": "次子与继母暂时抱团对抗强势的长女"}),
    ("zhao", "chengwan", "rival", 0.36, {"description": "多一个继承人就少一份钱,黎昭本能地排斥"}),
    ("suman", "chengwan", "rival", 0.4, {"description": "继母警惕这个会动摇自己地位的变量"}),
    ("chengwan", "yanqiu", "rival", 0.2, {"description": "程晚认定长女是名分路上最大的阻碍"}),
    # ── 仆从 / 专业人士的站位 ───────────────────────────────────
    ("zhoubo", "yanqiu", "ally", 0.55, {"description": "管家敬重长女的能干,却不尽认同她的心思"}),
    ("zhoubo", "chengwan", "ally", 0.5, {"description": "管家隐约知道老主人对这孩子的亏欠,暗中同情"}),
    ("zhoubo", "chenlv", "rival", 0.42, {"description": "管家觉得这律师太滑,信不过"}),
    ("chenlv", "yanqiu", "ally", 0.78, {"description": "律师的执行方案与长女的利益高度绑定"}),
    ("chenlv", "suman", "ally", 0.52, {"description": "现有遗嘱保住继母份额,二人乐见其成"}),
    ("guming", "suman", "ally", 0.5, {"description": "医生与继母关系微妙,彼此心照不宣"}),
    ("guming", "yanqiu", "rival", 0.45, {"description": "长女追问死亡细节,医生避之不及"}),
    ("guming", "zhao", "rival", 0.4, {"description": "医生隐约知道次子当夜去过书房"}),
    # ── 外来调查者切入 ─────────────────────────────────────────
    ("linsu", "guming", "rival", 0.45, {"description": "调查员盯着死亡证明上的破绽不放"}),
    ("linsu", "zhao", "rival", 0.4, {"description": "次子当夜的行踪是调查员最大的疑点"}),
    ("linsu", "suman", "rival", 0.38, {"description": "调查员对遗孀的哀戚存疑"}),
    ("linsu", "yanqiu", "ally", 0.35, {"description": "表面配合,实则各取所需"}),
    ("linsu", "chengwan", "ally", 0.42, {"description": "两个外来者,隐隐结成临时同盟"}),
    # ── 组织归属 ───────────────────────────────────────────────
    ("yanqiu", "lifamily", "member_of", 0.95),
    ("zhao", "lifamily", "member_of", 0.9),
    ("suman", "lifamily", "member_of", 0.85),
    ("zhoubo", "lifamily", "member_of", 0.8, {"description": "四十年家仆,情同半个家人"}),
    ("chengwan", "lifamily", "member_of", 0.3, {"description": "血缘未被承认,身份悬而未决"}),
    # ── 角色 ↔ 地点 ────────────────────────────────────────────
    ("yanqiu", "hall", "located_at", 0.8),
    ("zhao", "study", "located_at", 0.6, {"description": "总往书房附近转,似在找什么"}),
    ("suman", "hall", "located_at", 0.7),
    ("zhoubo", "attic", "located_at", 0.85, {"description": "唯一能进阁楼的人"}),
    ("guming", "study", "located_at", 0.55),
    ("chenlv", "hall", "located_at", 0.75),
    ("linsu", "study", "located_at", 0.65, {"description": "反复回到案发的书房勘查"}),
    ("chengwan", "pier", "located_at", 0.6, {"description": "孤身立在封航的码头边"}),
    # ── 事件 ↔ 地点 / 关键物证关联 ─────────────────────────────
    ("will_reading", "hall", "located_at", 0.9),
    ("true_will", "attic", "located_at", 0.8, {"description": "真遗嘱据信藏于阁楼旧物中"}),
    ("cause_verdict", "study", "located_at", 0.85, {"description": "死因线索集中在书房"}),
    # ── 角色 ↔ 事件(参与/牵连)──────────────────────────────────
    ("yanqiu", "will_reading", "participated", 0.9),
    ("zhao", "will_reading", "participated", 0.85),
    ("suman", "will_reading", "participated", 0.8),
    ("chenlv", "will_reading", "participated", 0.9, {"description": "宣读的执行者"}),
    ("chengwan", "will_reading", "participated", 0.6, {"description": "不请自来,要求列席"}),
    ("zhoubo", "true_will", "participated", 0.9, {"description": "真遗嘱的保管者"}),
    ("chenlv", "true_will", "participated", 0.7, {"description": "曾受托令其『不出现』"}),
    ("chengwan", "true_will", "participated", 0.55, {"description": "真遗嘱很可能于她有利"}),
    ("linsu", "cause_verdict", "participated", 0.9, {"description": "死因查证的主导者"}),
    ("guming", "cause_verdict", "participated", 0.8, {"description": "签证明者,首当其冲"}),
    ("zhao", "cause_verdict", "participated", 0.6, {"description": "当夜行踪成疑"}),
]

# entity_keys 在导入时解析为 entity_ids;无此字段则 scope 为 global。
WORLD_ENTRIES: list[dict] = [
    {
        "title": "雾港·黎氏庄园背景",
        "content": (
            "**黎氏**是雾港的航运世家,产业、人脉、债务皆系于家主黎崇山一身。"
            "三日前家主于书房暴毙,私人医生定为心疾自然死亡。今夜暴雨封岛、渡口停航,"
            "全族与几位关系人被困庄园,遗嘱将当众宣读——而岛上至少有三件事悬而未决:"
            "遗嘱的真伪、死亡的真相、以及一个突然现身的私生女。"
        ),
        "scope": "global",
        "priority": 100,
    },
    {
        "title": "遗产与继承规则",
        "content": (
            "依现行遗嘱,黎氏产业主体归长女黎砚秋,续弦苏曼按婚前协议得固定份额,"
            "次子黎昭仅得有限现金。但遗嘱若有后立版本,以**最后一份**为准、推翻在先安排。"
            "婚前协议另有一条:若证实苏曼婚内出轨,则其份额作废。"
        ),
        "scope": "global",
        "priority": 90,
    },
    {
        "title": "黎砚秋的心结",
        "content": (
            "父亲死前一周曾说要重立遗嘱、给那个外面的孩子正名。她当场翻脸离去,"
            "此后父亲便骤然离世。这段对话无人知晓,而它一旦被人提起,她将既是最大受益者、"
            "也是最大嫌疑人。守住现有遗嘱、压下死因疑云,是她唯一的活路。"
        ),
        "scope": "entity",
        "entity_keys": ["yanqiu"],
        "priority": 80,
    },
    {
        "title": "周伯的托付",
        "content": (
            "老主人临终前把一只火漆封缄的信封交到他手里,只说『时机到了,你自然知道该不该拿出来』。"
            "那是后立的真遗嘱,如今锁在阁楼。他认死理:这是老主人最后的意思,谁也别想逼他提前或永远咽下。"
        ),
        "scope": "entity",
        "entity_keys": ["zhoubo", "attic"],
        "priority": 80,
    },
    {
        "title": "顾明哲签下的字",
        "content": (
            "签死亡证明那晚,他注意到死者瞳孔与皮下的异样,不像单纯心疾,更像某种中毒。"
            "可有人在他耳边低声提醒了『后果』,他便把笔落在了『自然死亡』四个字上。"
            "只要无人重启鉴定,这件事就能烂在肚子里。"
        ),
        "scope": "entity",
        "entity_keys": ["guming"],
        "priority": 75,
    },
    {
        "title": "封岛之夜的规矩",
        "content": (
            "暴雨封航,码头缆绳空悬,今夜无人能离岛、无人能上岛——线索与凶手都困在同一栋楼里。"
            "电话线在雷雨中时断时续,庄园只能靠自己。天亮渡轮恢复前,一切都得在岛上了结。"
        ),
        "scope": "global",
        "priority": 70,
    },
]
