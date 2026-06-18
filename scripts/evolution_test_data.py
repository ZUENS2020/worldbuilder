"""演进测试图谱 — 6 人阵营冲突 + 秘密 + 多地点，适合反复跑 tick / 推演结算。

场景：霁川学园学生会换届前夜。主席与副主席派系对峙，转学生入局，旧仓库藏着选票疑云。
关系网刻意包含 enemy / rival / 低权重 ally，便于调度器产出实质变化。

两个预设「悬决事件」（status=pending + stakes + due_tick）是推演引擎的考点：
角色围绕它们博弈，到因果成熟或截止时由 ai_resolve_event 按世界状态结算，落下不可逆后果。

推荐模拟器配置（导入后新建模拟时可在 UI 调整，或参考下方 SIM_CONFIG）：
  - pending_max_age: 8（兜底步数，防永远卡 pending）
  - scheduler_mix_conflict: True（撮合对抗）
  - nudge_strategy: weighted
  - generate_events: True
  - max_encounters_per_tick: 4

导入：
  cd scripts && python3 import_world.py evolution_test_data
  # 或
  python3 seed_evolution_test.py
"""

PROJECT = {
    "name": "演进测试",
    "description": (
        "霁川学园学生会换届前夜：6 名角色、3 处地点、派系对峙与多条私有秘密。"
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

# 导入脚本不读取此常量；前端「演进测试」新建模拟时对齐此预设。
DRIVER_MODE = "hybrid"

SIM_CONFIG = {
    "max_encounters_per_tick": 4,
    "scheduler_strategy": "weighted",
    "scheduler_mix_conflict": True,
    "generate_events": True,
    "event_min_significance": 0.45,
    "event_dedupe": True,
    "tick_interval_sec": 8,
    "nudge_strategy": "weighted",
    "nudge_every_n_ticks": 2,
    "nudge_targets_per_tick": 2,
    "nudge_intensity": 0.55,
    # 推演：结果由世界状态因果推演。
    "pending_max_age": 8,
}

ENTITIES: dict[str, dict] = {
    # ── 角色 ─────────────────────────────────────────────────────
    "su": {
        "name": "苏晚晴",
        "type": "character",
        "properties": {
            "personality": "干练克制，习惯把情绪藏在公事公办的面具后面",
            "goal": "平稳交棒并公开选票舞弊证据，不让陆屿上位",
            "occupation": "学生会主席（现任）",
            "mood": "紧绷",
            "secret": "旧仓库通风管夹层藏有舞弊选票复印件，钥匙在陈默手里",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "lu": {
        "name": "陆屿",
        "type": "character",
        "properties": {
            "personality": "圆滑进取，擅长拉拢人心，失败时会翻脸",
            "goal": "在明日选举中夺下主席席位，并抹掉对自己不利的痕迹",
            "occupation": "学生会副主席",
            "mood": "跃跃欲试",
            "secret": "已与两名干事私下承诺选后职务交换，其中一人尚未公开站队",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "jiang": {
        "name": "江澈",
        "type": "character",
        "properties": {
            "personality": "正直执拗，眼里容不得沙子，对喜欢的人也一样笨拙",
            "goal": "帮苏晚晴守住选举公正，同时想弄清陆屿背后有谁撑腰",
            "occupation": "纪律委员",
            "mood": "焦躁",
        },
    },
    "xu": {
        "name": "许瑶",
        "type": "character",
        "properties": {
            "personality": "笑面玲珑，消息灵通，把情报当筹码",
            "goal": "押注赢家并换取宣传部实权，必要时放出苏晚晴的黑料",
            "occupation": "宣传部长",
            "mood": "算计",
            "secret": "握有苏晚晴上月深夜独自进入旧仓库的照片，尚未示人",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "chen": {
        "name": "陈默",
        "type": "character",
        "properties": {
            "personality": "寡言少语，谁给面子就帮谁，但有自己的底线",
            "goal": "不得罪任何派系，保住后勤部位置与奖学金资格",
            "occupation": "后勤部长",
            "mood": "犹豫",
            "secret": "旧仓库侧门钥匙在他抽屉底层，苏晚晴知道此事但从未点破",
            "_prop_visibility": {"secret": {"level": "private"}},
        },
    },
    "fang": {
        "name": "方辞",
        "type": "character",
        "properties": {
            "personality": "外来者的好奇与疏离感并存，观察力敏锐",
            "goal": "弄清这所学园水面下的规则，再决定站哪一边",
            "occupation": "转学生（学生会观察员）",
            "mood": "警觉",
        },
    },
    # ── 组织 / 地点 / 事件 ───────────────────────────────────────
    "council": {
        "name": "霁川学园学生会",
        "type": "faction",
        "properties": {
            "description": "名义管理全校学生事务；换届选举明日午后举行，各部长席位一并改选。",
        },
    },
    "office": {
        "name": "学生会办公室",
        "type": "location",
        "properties": {
            "description": "行政楼三层，派系密谈与公开协调的主战场，窗外可见操场。",
        },
    },
    "warehouse": {
        "name": "旧仓库",
        "type": "location",
        "properties": {
            "description": "校园西北角废弃储物间，上锁，传闻有人深夜出入。",
        },
    },
    "rooftop": {
        "name": "教学楼天台",
        "type": "location",
        "properties": {
            "description": "闭馆前常有人上来透气；风声大，适合说不想被听见的话。",
        },
    },
    "fraud": {
        "name": "选票舞弊疑云",
        "type": "event",
        "properties": {
            "description": "上月补选出现票箱差额，监控死角恰在旧仓库一侧，校方暂未公告结论。",
            "time": "上月",
            # 预设悬决事件：到因果成熟或截止时由 ai_resolve_event 结算。
            "status": "pending",
            "stakes": "舞弊证据若被坐实，相关者将身败名裂、丧失参选资格；若被压下，则反咬揭发者。",
            "due_tick": 7,
            "sequence_order": 1,
            "participant_names": ["苏晚晴", "陆屿", "江澈", "陈默"],
        },
    },
    "election": {
        "name": "明日学生会选举",
        "type": "event",
        "properties": {
            "description": "主席与核心部长改选；得票将决定未来一学年资源分配与人事布局。",
            "time": "明日午后",
            "status": "pending",
            "stakes": "主席席位归属——谁当选将主导一学年的资源与人事；落败方将失势。",
            "due_tick": 9,
            "sequence_order": 2,
            "participant_names": ["苏晚晴", "陆屿", "江澈", "许瑶"],
        },
    },
}

RELATIONS: list = [
    # 派系核心矛盾
    ("su", "lu", "rival", 0.32, {"description": "表面合作，实则争夺主席继任"}),
    ("lu", "jiang", "enemy", 0.22, {"description": "江澈多次公开质疑陆屿的经费流向"}),
    ("xu", "su", "enemy", 0.28, {"description": "许瑶握有黑料，苏晚晴对她提防又不得不忍"}),
    ("lu", "xu", "ally", 0.9, {"description": "宣传口与副主席派系利益绑定"}),
    ("su", "jiang", "ally", 0.88, {"description": "纪律委员是主席最坚定的公开支持者"}),
    ("xu", "jiang", "rival", 0.42, {"description": "江澈厌恶许瑶拿八卦当武器"}),
    # 摇摆位与新人
    ("chen", "su", "ally", 0.62, {"description": "后勤口依赖主席签字，但不想彻底得罪陆屿"}),
    ("chen", "lu", "ally", 0.58, {"description": "陆屿许诺选后设备采购优先权"}),
    ("chen", "jiang", "rival", 0.48, {"description": "江澈曾逼陈默交代仓库钥匙去向"}),
    ("fang", "su", "ally", 0.45, {"description": "转学生先接近现任主席了解规则"}),
    ("fang", "lu", "rival", 0.38, {"description": "陆屿怀疑方辞是校方派来的眼睛"}),
    ("fang", "xu", "ally", 0.4, {"description": "许瑶主动递过情报，试探方辞立场"}),
    # 组织归属
    ("su", "council", "member_of", 0.95),
    ("lu", "council", "member_of", 0.95),
    ("jiang", "council", "member_of", 0.9),
    ("xu", "council", "member_of", 0.9),
    ("chen", "council", "member_of", 0.85),
    ("fang", "council", "member_of", 0.5, {"description": "观察员身份，无投票权"}),
    # 地点
    ("su", "office", "located_at", 0.85),
    ("lu", "office", "located_at", 0.85),
    ("jiang", "office", "located_at", 0.7),
    ("xu", "office", "located_at", 0.75),
    ("chen", "warehouse", "located_at", 0.8),
    ("fang", "rooftop", "located_at", 0.6),
    ("office", "council", "located_at", 0.9),
    # 事件关联
    ("fraud", "warehouse", "located_at", 0.85, {"description": "舞弊疑云与仓库监控死角相关"}),
    ("su", "fraud", "participated", 0.8),
    ("lu", "fraud", "participated", 0.55, {"description": "被质疑阵营，本人否认"}),
    ("chen", "fraud", "participated", 0.7, {"description": "掌管仓库钥匙，无法完全撇清"}),
    ("election", "office", "located_at", 0.9),
    ("su", "election", "participated", 0.95),
    ("lu", "election", "participated", 0.95),
    ("jiang", "election", "participated", 0.85),
    ("xu", "election", "participated", 0.8),
    ("chen", "election", "participated", 0.65),
    ("fang", "election", "participated", 0.5),
]

# entity_keys 在导入时解析为 entity_ids；无此字段则 scope 为 global。
WORLD_ENTRIES: list[dict] = [
    {
        "title": "霁川学园换届背景",
        "content": (
            "**霁川学园**以理工科见长，学生会掌控活动经费审批与社团评级。"
            "主席任期一年，明日选举采用现场投票+计票直播；"
            "若出现舞弊指控且证据确凿，选举委员会有权暂停唱票。"
        ),
        "scope": "global",
        "priority": 100,
    },
    {
        "title": "苏晚晴的交接备忘",
        "content": (
            "交棒前必须守住两件事：一是选举程序不能出岔子，二是舞弊证据"
            "只能在唱票前以正当渠道公开。陈默的钥匙是底牌，不能逼太紧。"
        ),
        "scope": "entity",
        "entity_keys": ["su"],
        "priority": 80,
    },
    {
        "title": "陆屿的拉票清单",
        "content": (
            "后勤陈默——设备采购承诺已口头给出；宣传部许瑶——选后实权写入备忘录；"
            "转学生方辞——待观察，可用「学生会改革」话术试探。"
            "江澈是阻力，尽量避开正面冲突，由许瑶牵制。"
        ),
        "scope": "entity",
        "entity_keys": ["lu"],
        "priority": 80,
    },
    {
        "title": "旧仓库出入规矩",
        "content": (
            "旧仓库侧门上锁，钥匙由后勤部长保管；"
            "非维修事由夜间禁止入内。上月补选前夜监控曾短暂中断。"
        ),
        "scope": "entity",
        "entity_keys": ["chen", "warehouse"],
        "priority": 70,
    },
]
