"""模拟器测试用最小图谱 — 3 人 + 1 地点 + 1 事件，够跑 tick / 信念 / 迷雾。

场景：老城茶馆里的失窃案，三人各怀心思，适合单步推进观察 Actor / Oracle / Belief 差异。

导入：
  cd scripts && python3 import_world.py sim_test_data
  # 或
  python3 seed_sim_test.py
"""

PROJECT = {
    "name": "模拟器测试",
    "description": "最小测试图谱：3 名角色、茶馆、失窃案。含一条私有秘密属性，用于信念/真相对比。",
    "settings": {
        "graph_hops": {
            "transform_expand": 1,
            "transform_enemy": 2,
            "ai_context": 1,
            "context_injection": 2,
            "isolate_subgraph": 2,
        },
    },
}

ENTITIES: dict[str, dict] = {
    "lin": {
        "name": "林远",
        "type": "character",
        "properties": {
            "personality": "冷静缜密，不爱废话",
            "goal": "查清珠宝失窃案，揪出内鬼",
            "occupation": "私家侦探",
            "mood": "警觉",
        },
    },
    "xia": {
        "name": "小夏",
        "type": "character",
        "properties": {
            "personality": "冲动直率，讲义气但藏不住事",
            "goal": "帮林远破案，证明自己不是累赘",
            "occupation": "侦探助手",
            "mood": "焦躁",
            # 仅自己可见 — 其他角色信念里不应出现，直到 Oracle 揭示
            "secret": "私下收了盗贼的封口费，想先稳住对方再坦白",
            "_prop_visibility": {
                "secret": {"level": "private"},
            },
        },
    },
    "ming": {
        "name": "阿明",
        "type": "character",
        "properties": {
            "personality": "圆滑胆小，见风使舵",
            "goal": "两头讨好，保住小命和赏钱",
            "occupation": "茶馆线人",
            "mood": "忐忑",
        },
    },
    "teahouse": {
        "name": "老城茶馆",
        "type": "location",
        "properties": {
            "description": "城东老字号，三教九流消息灵通，案发当晚林远与小夏在此蹲守。",
        },
    },
    "theft": {
        "name": "珠宝失窃案",
        "type": "event",
        "properties": {
            "description": "富商家传玉佩失窃，悬赏丰厚；坊间传闻内鬼通风报信。",
            "time": "案发后第三夜",
        },
    },
}

# (source_key, target_key, type, weight?, props?)
RELATIONS: list = [
    ("lin", "xia", "ally", 0.9, {"description": "搭档三年，互相信任但最近有些摩擦"}),
    ("lin", "ming", "ally", 0.65, {"description": "长期线人，情报时灵时不灵"}),
    ("xia", "ming", "rival", 0.55, {"description": "小夏觉得阿明不可靠，阿明怕小夏坏他财路"}),
    ("lin", "teahouse", "located_at", 0.5),
    ("xia", "teahouse", "located_at", 0.5),
    ("ming", "teahouse", "located_at", 0.8),
    ("theft", "teahouse", "located_at", 0.7, {"description": "蹲守与接头多在此地"}),
    ("lin", "theft", "participated", 0.85),
    ("xia", "theft", "participated", 0.8),
    ("ming", "theft", "participated", 0.6, {"description": "声称当晚见过可疑生客"}),
]
