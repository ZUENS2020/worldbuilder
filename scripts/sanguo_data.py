"""三国演义（罗贯中原著）世界观数据 — 人物、阵营、地点、事件、器物与关系网。"""

PROJECT = {
    "name": "三国演义",
    "description": "罗贯中《三国演义》原著世界观知识图谱。人物关系、重大战役与地理脉络均依演义叙事，不含演义外野史臆造。",
    "settings": {
        "graph_hops": {
            "transform_expand": 1,
            "transform_enemy": 2,
            "ai_context": 1,
            "writing_context": 2,
            "isolate_subgraph": 2,
        },
    },
}

# key → entity definition
ENTITIES: dict[str, dict] = {}

def _c(key, name, **props):
    ENTITIES[key] = {"name": name, "type": "character", "properties": props}

def _f(key, name, **props):
    ENTITIES[key] = {"name": name, "type": "faction", "properties": props}

def _l(key, name, **props):
    ENTITIES[key] = {"name": name, "type": "location", "properties": props}

def _e(key, name, **props):
    ENTITIES[key] = {"name": name, "type": "event", "properties": props}

def _i(key, name, **props):
    ENTITIES[key] = {"name": name, "type": "item", "properties": props}


# ── 阵营 ────────────────────────────────────────────────────────
_f("han", "东汉朝廷", description="汉灵帝、少帝、献帝在位之正统皇权，后期名存实亡。", era="东汉末年至220年")
_f("wei", "曹魏", description="曹操挟天子以令诸侯后奠基，曹丕受禅称帝，都洛阳。", era="220年—265年")
_f("shu", "蜀汉", description="刘备汉中王称帝，诸葛亮辅政，都成都，以兴复汉室为号。", era="221年—263年")
_f("wu", "东吴", description="孙权继父兄基业据江东，赤壁后三分天下，都建业。", era="222年—280年")
_f("dongzhuo", "董卓集团", description="董卓入京废立天子，祸乱京师，诸侯共讨。", era="189年—192年")
_f("lvbu", "吕布集团", description="吕布勇而无谋，先后附董卓、刘备，据下邳。", era="192年—199年")
_f("yuanshao", "袁绍集团", description="四世三公，据河北，官渡败后势力瓦解。", era="190年—207年")
_f("huangjin", "黄巾军", description="张角太平道起义，苍天已死黄天当立。", era="184年")
_f("nanman", "南中诸部", description="益州南部蛮夷，诸葛亮七擒孟获后归附蜀汉。", era="蜀汉时期")

# ── 核心人物：蜀汉 ─────────────────────────────────────────────
_c("liubei", "刘备", courtesy_name="玄德", alias="刘皇叔", gender="男",
   personality="仁德宽厚、知人善任、百折不挠", goal="兴复汉室、匡扶正统",
   background="中山靖王之后，织席贩履起家，桃园结义，三顾茅庐得诸葛亮，终建蜀汉。",
   occupation="蜀汉昭烈帝", weapon="雌雄双股剑")
_c("guanyu", "关羽", courtesy_name="云长", alias="美髯公", gender="男",
   personality="忠义刚烈、傲上而不忍下", goal="扶兄匡汉",
   background="河东解良人，桃园结义，千里走单骑，水淹七军威震华夏，失荆州败走麦城。",
   occupation="五虎上将之首", weapon="青龙偃月刀", death="219年麦城兵败被擒遇害")
_c("zhangfei", "张飞", courtesy_name="翼德", gender="男",
   personality="勇猛暴烈、敬君子而不恤小人", goal="辅佐兄长",
   background="涿郡人，桃园结义，长坂坡喝退曹军，阆中遇害。",
   occupation="五虎上将", weapon="丈八蛇矛", death="221年范疆张达弑主")
_c("zhugeliang", "诸葛亮", courtesy_name="孔明", alias="卧龙", gender="男",
   personality="谨慎多谋、鞠躬尽瘁", goal="北定中原、兴复汉室",
   background="琅琊阳都人，隆中对策三分天下，辅刘备建蜀，六出祁山，卒于五丈原。",
   occupation="蜀汉丞相", weapon="羽扇", death="234年五丈原病逝")
_c("zhaoyun", "赵云", courtesy_name="子龙", gender="男",
   personality="忠勇沉稳", goal="护卫主公与少主",
   background="常山真定人，长坂坡七进七出救阿斗，后封镇军将军。",
   occupation="五虎上将")
_c("machao", "马超", courtesy_name="孟起", gender="男",
   personality="骁勇善战", background="西凉马腾之子，潼关战曹操，后归刘备封五虎上将。",
   occupation="五虎上将")
_c("huangzhong", "黄忠", courtesy_name="汉升", gender="男",
   personality="老当益壮", background="长沙降将，定军山斩夏侯渊。", occupation="五虎上将")
_c("pangtong", "庞统", courtesy_name="士元", alias="凤雏", gender="男",
   personality="奇谋善断", background="襄阳人，与诸葛亮齐名，献连环计于赤壁，殒命落凤坡。",
   death="211年入蜀途中中伏身亡")
_c("fazheng", "法正", courtesy_name="孝直", gender="男",
   personality="奇谋善断", background="助刘备取益州、汉中，诸葛亮称其助太祖定蜀之功。",
   death="220年病逝")
_c("jiangwan", "蒋琬", courtesy_name="公琰", gender="男", background="诸葛亮后继者，与费祎共掌朝政。", occupation="蜀汉大将军")
_c("feiyi", "费祎", courtesy_name="文伟", gender="男", background="蜀汉后期重臣，主持国事。", occupation="蜀汉尚书令")
_c("jiangwei", "姜维", courtesy_name="伯约", gender="男",
   personality="坚毅执拗", goal="继承武侯遗志北伐",
   background="天水人，诸葛亮弟子，九伐中原，蜀汉亡后仍图复国。",
   occupation="蜀汉大将军")
_c("liushan", "刘禅", courtesy_name="公嗣", alias="阿斗", gender="男",
   background="刘备长子，继位后主，乐不思蜀。", occupation="蜀汉后主")
_c("guanping", "关平", gender="男", background="关羽义子，随父守荆州，麦城同殉。")
_c("masu", "马谡", courtesy_name="幼常", gender="男",
   background="街亭失守致北伐受挫，诸葛亮挥泪斩之。")
_c("huangyueying", "黄月英", gender="女", background="诸葛亮之妻，丑而贤，传善机关之术。")

# ── 曹魏 ────────────────────────────────────────────────────────
_c("caocao", "曹操", courtesy_name="孟德", alias="奸雄", gender="男",
   personality="雄才大略、多疑善断", goal="统一天下",
   background="沛国谯县人，挟天子以令诸侯，官渡败袁绍，赤壁败于孙刘联军，封魏王。",
   occupation="魏武帝（追尊）")
_c("caopi", "曹丕", courtesy_name="子桓", gender="男",
   background="曹操长子，逼献帝禅让，建魏称帝。", occupation="魏文帝")
_c("caozhi", "曹植", courtesy_name="子建", gender="男",
   background="曹操三子，才高八斗，《七步诗》典故。", occupation="陈思王")
_c("simayi", "司马懿", courtesy_name="仲达", gender="男",
   personality="隐忍多谋", background="河内温县人，曹魏重臣，诛曹爽掌大权，为其孙司马炎篡魏奠基。",
   occupation="太傅")
_c("simazhao", "司马昭", gender="男", background="司马懿之子，专擅朝政，灭蜀汉。", occupation="晋文王")
_c("simayan", "司马炎", gender="男", background="司马昭之子，篡魏建晋，后灭东吴统一天下。", occupation="晋武帝")
_c("xunyu", "荀彧", courtesy_name="文若", gender="男", background="曹操首席谋臣，王佐之才，后因反对晋爵而自尽。")
_c("xunyou", "荀攸", courtesy_name="公达", gender="男", background="曹操谋臣，官渡奇谋百出。")
_c("guojia", "郭嘉", courtesy_name="奉孝", gender="男",
   background="曹操鬼才谋士，官渡前献计，征乌桓时病逝。")
_c("chengpu", "程昱", gender="男", background="曹操谋士，多次献策。")
_c("jiaxu", "贾诩", gender="男", background="毒士，先后事董卓、张绣、曹操，善保身全族。")
_c("xuchu", "许褚", gender="男", background="曹操宿卫，虎痴，裸衣战马超。")
_c("dianwei", "典韦", gender="男", background="古之恶来，宛城死战护曹操。", death="197年宛城战死")
_c("xiahoudun", "夏侯惇", courtesy_name="元让", gender="男", background="曹操族弟，拔矢啖睛。")
_c("xiahouyuan", "夏侯渊", gender="男", background="曹操名将，定军山为黄忠所斩。", death="219年")
_c("zhangliao", "张辽", courtesy_name="文远", gender="男", background="五子良将之首，合肥之战威震江东。")
_c("xuhuang", "徐晃", gender="男", background="五子良将，解樊城之围。")
_c("zhanghe", "张郃", gender="男", background="五子良将，街亭败马谡，木门道中伏身亡。")
_c("caoren", "曹仁", gender="男", background="曹操族弟，守樊城。")
_c("yuejin", "乐进", gender="男", background="五子良将。")
_c("yujin", "于禁", gender="男", background="五子良将，水淹七军降关羽。")
_c("dengai", "邓艾", gender="男", background="灭蜀名将，偷渡阴平破成都。", death="264年被钟会诬害")
_c("zhonghui", "钟会", gender="男", background="灭蜀名将，后谋反死于乱军。", death="264年")

# ── 东吴 ────────────────────────────────────────────────────────
_c("sunjian", "孙坚", gender="男", background="江东猛虎，讨董先锋，得玉玺，殒命岘山。", death="191年")
_c("sunce", "孙策", courtesy_name="伯符", alias="小霸王", gender="男",
   background="孙坚长子，平定江东，英年早逝。", death="200年")
_c("sunquan", "孙权", courtesy_name="仲谋", gender="男",
   personality="善于用人、守成之主", background="继兄基业据江东，赤壁联刘抗曹，晚年立嗣引发二宫之争。",
   occupation="吴大帝")
_c("zhouyu", "周瑜", courtesy_name="公瑾", gender="男",
   personality="英武儒雅", background="赤壁之战总指挥，与诸葛亮斗智，遗计杀蔡瑁张允。",
   death="210年病逝")
_c("lusu", "鲁肃", courtesy_name="子敬", gender="男", background="联刘抗曹主谋，借荆州于刘备。")
_c("lvmeng", "吕蒙", gender="男", background="白衣渡江袭荆州，吴下阿蒙刮目相待。", death="220年")
_c("luxun", "陆逊", gender="男", background="夷陵之战火烧连营大破刘备，后期为孙权所忌。", occupation="东吴大都督")
_c("huanggai", "黄盖", gender="男", background="赤壁苦肉计诈降，火攻破曹。")
_c("ganning", "甘宁", courtesy_name="兴霸", gender="男", background="锦帆贼，百骑劫魏营。")
_c("taishici", "太史慈", gender="男", background="神射，北海救孔融，后归孙策。", death="206年")
_c("sunshangxiang", "孙尚香", gender="女", background="孙权之妹，嫁刘备，后归吴。")
_c("lukang", "陆抗", gender="男", background="陆逊之子，守荆州抗晋。")

# ── 董卓系与诸侯 ────────────────────────────────────────────────
_c("dongzhuo_p", "董卓", gender="男",
   personality="残暴专横", background="西凉军阀，废少帝立献帝，迁都长安，为王允连环计所杀。",
   death="192年")
_c("lvbu", "吕布", courtesy_name="奉先", alias="飞将", gender="男",
   personality="骁勇无义", background="三姓家奴，虎牢关战三英，下邳被曹操所擒处死。",
   weapon="方天画戟", death="199年")
_c("diaochan", "貂蝉", gender="女", background="王允义女，连环计离间董卓吕布。")
_c("liru", "李儒", gender="男", background="董卓谋士，毒杀少帝。")
_c("huaxiong", "华雄", gender="男", background="董卓部将，汜水关被关羽温酒斩于马下。", death="191年")
_c("yuanshao_p", "袁绍", gender="男",
   background="四世三公，官渡败于曹操，仓皇北归后病死。", death="202年")
_c("yuanshu", "袁术", gender="男", background="袁绍从弟，僭号称帝，呕血而死。")
_c("yanliang", "颜良", gender="男", background="袁绍大将，官渡前为关羽所斩。", death="200年")
_c("wenchou", "文丑", gender="男", background="袁绍大将，官渡前为关羽所斩。", death="200年")
_c("liubiao", "刘表", gender="男", background="荆州牧，八骏之一，后病死荆州易主。")
_c("liuzhang", "刘璋", gender="男", background="益州牧，刘备入川后让出益州。")

# ── 其他重要人物 ────────────────────────────────────────────────
_c("zhangjiao", "张角", gender="男", background="太平道首领，黄巾起义领袖。", death="184年")
_c("huatuo", "华佗", gender="男", background="神医，曾为关羽刮骨疗毒，后为曹操所杀。")
_c("xiandi", "汉献帝", alias="刘协", gender="男", background="东汉末代皇帝，曹丕逼禅让。")
_c("wangyun", "王允", gender="男", background="司徒，设连环计除董卓。", death="192年李傕郭汜之乱")
_c("meng获", "孟获", gender="男", background="南中首领，诸葛亮七擒七纵后归心。")
_c("zhurong", "祝融夫人", gender="女", background="孟获之妻，南中女将，善飞刀。")
_c("caiwenji", "蔡文姬", gender="女", background="蔡邕之女，胡笳十八拍作者，曹操赎归。")

# ── 地点 ────────────────────────────────────────────────────────
_l("luoyang", "洛阳", description="东汉都城，董卓迁都前朝廷所在。", region="司隶")
_l("changan", "长安", description="董卓迁都之地，王允诛董卓后乱起。", region="雍州")
_l("xuchang", "许昌", description="曹操迎献帝后大本营，魏国政治中心。", region="豫州")
_l("ye", "邺城", description="袁绍根据地，后曹魏北方重镇。", region="冀州")
_l("chengdu", "成都", description="蜀汉都城，刘备称帝处。", region="益州")
_l("jianye", "建业", description="东吴都城，今南京一带。", region="扬州")
_l("jingzhou", "荆州", description="天下咽喉，魏蜀吴必争之地。", region="荆州")
_l("hanzhong", "汉中", description="益州北大门，刘备称汉中王之地。", region="益州")
_l("jiangling", "江陵", description="荆州重镇，关羽镇守、吕蒙袭取。", region="荆州")
_l("fancheng", "樊城", description="关羽水淹七军、败走麦城前奏。", region="荆州")
_l("xinye", "新野", description="刘备屯兵，三顾茅庐发生地。", region="荆州")
_l("guandu", "官渡", description="曹操袁绍决战之地。", region="豫州")
_l("chibi", "赤壁", description="孙刘联军火攻破曹之地。", region="荆州")
_l("yiling", "夷陵", description="陆逊火烧连营破刘备之地。", region="荆州")
_l("jiating", "街亭", description="马谡失守致诸葛亮第一次北伐受挫。", region="雍州")
_l("wuzhangyuan", "五丈原", description="诸葛亮第六次北伐病逝之地。", region="雍州")
_l("baidi", "白帝城", description="刘备托孤诸葛亮之地。", region="益州")
_l("maicheng", "麦城", description="关羽败亡之地。", region="荆州")
_l("xiapi", "下邳", description="吕布白门楼被擒之地。", region="徐州")
_l("hulaoguan", "虎牢关", description="十八路诸侯讨董，三英战吕布。", region="司隶")
_l("runan", "濡须口", description="曹操孙权对峙江淮。", region="扬州")
_l("xiliang", "西凉", description="马超韩遂之地，曹操西征。", region="凉州")
_l("nanzhong", "南中", description="诸葛亮南征孟获之地。", region="益州")
_l("luoyang_dong", "汜水关", description="华雄守关，温酒斩华雄。", region="司隶")
_l("dingjunshan", "定军山", description="黄忠斩夏侯渊。", region="益州")

# ── 重大事件（依演义叙事顺序）────────────────────────────────────
_e("huangjin", "黄巾起义", time="184年", description="张角兄弟揭竿，东汉政权动摇。")
_e("taoyuan", "桃园结义", time="184年后", description="刘备关羽张飞涿郡桃园结义，不求同年同月同日生。")
_e("sanying", "三英战吕布", time="190年", description="虎牢关前刘关张大战吕布。")
_e("zhujiulun", "煮酒论英雄", time="约200年", description="曹操与刘备青梅煮酒论天下英雄。")
_e("guandu_b", "官渡之战", time="200年", description="曹操以少胜多破袁绍，北方定。")
_e("qianli", "千里走单骑", time="约200年", description="关羽挂印封金，过五关斩六将寻兄。")
_e("chibi_b", "赤壁之战", time="208年", description="孙刘联军火攻，曹操败走华容道。")
_e("sangu", "三顾茅庐", time="207年", description="刘备三次拜访诸葛亮，隆中对策。")
_e("caochuan", "草船借箭", time="208年", description="诸葛亮草船借箭十万枝。")
_e("jieDongfeng", "借东风", time="208年", description="诸葛亮祭风助周瑜火攻。")
_e("huarong", "华容道义释曹操", time="208年", description="关羽念旧恩放曹操离去。")
_e("qiji", "七擒孟获", time="225年", description="诸葛亮南征，七擒七纵孟获。")
_e("dandao", "单刀赴会", time="215年", description="关羽赴鲁肃宴会，安然脱身。")
_e("shuimang", "水淹七军", time="219年", description="关羽樊城水淹于禁庞德，威震华夏。")
_e("baiyi", "白衣渡江", time="219年", description="吕蒙诈病，袭取荆州。")
_e("maicheng_b", "败走麦城", time="219年", description="关羽失荆州，麦城兵败身死。")
_e("yiling_b", "夷陵之战", time="222年", description="刘备伐吴，陆逊火烧连营。")
_e("tuogu", "白帝城托孤", time="223年", description="刘备病危托孤诸葛亮与李严。")
_e("chutian", "出师表", time="227年", description="诸葛亮上《出师表》北伐中原。")
_e("jieTing", "街亭之战", time="228年", description="马谡失守街亭，诸葛亮退兵。")
_e("wuzhang_b", "五丈原病逝", time="234年", description="诸葛亮星落秋风五丈原。")
_e("mieshu", "蜀汉灭亡", time="263年", description="邓艾偷渡阴平，刘禅降魏。")
_e("miewu", "东吴灭亡", time="280年", description="晋军渡江，孙皓降，天下归晋。")
_e("dongzhuo_ru", "董卓入京", time="189年", description="董卓挟天子，废少帝立献帝。")
_e("lianhuan", "连环计", time="192年", description="王允貂蝉离间董卓吕布。")
_e("xiapeip", "白门楼", time="199年", description="曹操擒吕布于下邳白门楼。")
_e("dingjun", "定军山之战", time="219年", description="黄忠阵斩夏侯渊。")

# ── 器物 ────────────────────────────────────────────────────────
_i("qinglong", "青龙偃月刀", description="关羽兵器，重八十二斤。", owner="关羽")
_i("shemao", "丈八蛇矛", description="张飞兵器。", owner="张飞")
_i("shuanggu", "雌雄双股剑", description="刘备兵器。")
_i("fangtian", "方天画戟", description="吕布兵器。", owner="吕布")
_i("chitu", "赤兔马", description="吕布坐骑，后关羽骑乘。", owner="关羽")
_i("dilu", "的卢", description="刘备坐骑，跃檀溪脱险。", owner="刘备")
_i("qixing", "七星宝刀", description="王允之宝，曹操献刀刺董卓未遂。")
_i("yuxi", "传国玉玺", description="孙坚得于井中，象征天命。")
_i("muniu", "木牛流马", description="诸葛亮北伐运粮器械。")

# Relations: (source_key, target_key, type, weight?, props?)
RELATIONS: list[tuple] = [
    # 阵营归属
    ("liubei", "shu", "member_of", 1.0, {}),
    ("guanyu", "shu", "member_of", 1.0, {}),
    ("zhangfei", "shu", "member_of", 1.0, {}),
    ("zhugeliang", "shu", "member_of", 1.0, {}),
    ("zhaoyun", "shu", "member_of", 1.0, {}),
    ("machao", "shu", "member_of", 1.0, {}),
    ("huangzhong", "shu", "member_of", 1.0, {}),
    ("jiangwei", "shu", "member_of", 1.0, {}),
    ("liushan", "shu", "member_of", 1.0, {}),
    ("caocao", "wei", "member_of", 1.0, {}),
    ("caopi", "wei", "member_of", 1.0, {}),
    ("simayi", "wei", "member_of", 1.0, {}),
    ("xunyu", "wei", "member_of", 1.0, {}),
    ("guojia", "wei", "member_of", 1.0, {}),
    ("zhangliao", "wei", "member_of", 1.0, {}),
    ("sunquan", "wu", "member_of", 1.0, {}),
    ("zhouyu", "wu", "member_of", 1.0, {}),
    ("luxun", "wu", "member_of", 1.0, {}),
    ("dongzhuo_p", "dongzhuo", "member_of", 1.0, {}),
    ("lvbu", "dongzhuo", "member_of", 0.6, {"note": "早年附董卓"}),
    ("lvbu", "lvbu", "member_of", 1.0, {}),
    ("yuanshao_p", "yuanshao", "member_of", 1.0, {}),
    ("zhangjiao", "huangjin", "member_of", 1.0, {}),
    ("meng获", "nanman", "member_of", 1.0, {}),
    ("xiandi", "han", "member_of", 1.0, {}),

    # 桃园结义与君臣
    ("liubei", "guanyu", "family", 1.0, {"relation": "义兄弟"}),
    ("liubei", "zhangfei", "family", 1.0, {"relation": "义兄弟"}),
    ("guanyu", "zhangfei", "family", 1.0, {"relation": "义兄弟"}),
    ("liubei", "zhugeliang", "subordinate", 1.0, {"relation": "君臣"}),
    ("zhugeliang", "liubei", "subordinate", 0.9, {"relation": "托孤重臣"}),
    ("liubei", "zhaoyun", "subordinate", 0.9, {}),
    ("liubei", "pangtong", "subordinate", 0.8, {}),
    ("liubei", "fazheng", "subordinate", 0.8, {}),
    ("zhugeliang", "jiangwei", "mentor", 1.0, {}),
    ("jiangwei", "zhugeliang", "subordinate", 1.0, {}),
    ("guanyu", "guanping", "family", 1.0, {"relation": "义父子"}),
    ("zhugeliang", "huangyueying", "lover", 1.0, {}),
    ("liubei", "liushan", "family", 1.0, {"relation": "父子"}),
    ("liushan", "liubei", "family", 1.0, {"relation": "父子"}),

    # 曹魏君臣
    ("caocao", "xunyu", "subordinate", 1.0, {}),
    ("caocao", "guojia", "subordinate", 1.0, {}),
    ("caocao", "jiaxu", "subordinate", 0.9, {}),
    ("caocao", "xuchu", "subordinate", 0.9, {}),
    ("caocao", "dianwei", "subordinate", 0.9, {}),
    ("caocao", "xiahoudun", "subordinate", 0.9, {}),
    ("caocao", "zhangliao", "subordinate", 0.9, {}),
    ("caocao", "caopi", "family", 1.0, {"relation": "父子"}),
    ("caocao", "caozhi", "family", 1.0, {"relation": "父子"}),
    ("simayi", "simazhao", "family", 1.0, {"relation": "父子"}),
    ("simazhao", "simayan", "family", 1.0, {"relation": "父子"}),

    # 孙氏江东
    ("sunjian", "sunce", "family", 1.0, {"relation": "父子"}),
    ("sunce", "sunquan", "family", 1.0, {"relation": "兄弟"}),
    ("sunjian", "sunquan", "family", 1.0, {"relation": "父子"}),
    ("sunquan", "zhouyu", "subordinate", 1.0, {}),
    ("sunquan", "luxun", "subordinate", 1.0, {}),
    ("sunquan", "sunshangxiang", "family", 1.0, {"relation": "兄妹"}),
    ("sunshangxiang", "liubei", "lover", 0.8, {"relation": "政治联姻"}),
    ("luxun", "lukang", "family", 1.0, {"relation": "父子"}),

    # 敌对
    ("caocao", "liubei", "enemy", 1.0, {}),
    ("caocao", "yuanshao_p", "enemy", 1.0, {}),
    ("caocao", "lvbu", "enemy", 1.0, {}),
    ("caocao", "dongzhuo_p", "enemy", 0.9, {}),
    ("liubei", "caocao", "enemy", 1.0, {}),
    ("liubei", "sunquan", "rival", 0.7, {"note": "后期荆州之争"}),
    ("guanyu", "lvbu", "enemy", 0.9, {}),
    ("guanyu", "yanliang", "enemy", 1.0, {}),
    ("guanyu", "wenchou", "enemy", 1.0, {}),
    ("zhugeliang", "simayi", "rival", 1.0, {}),
    ("zhouyu", "zhugeliang", "rival", 0.9, {"note": "既生瑜何生亮"}),
    ("luxun", "liubei", "enemy", 1.0, {}),
    ("dongzhuo_p", "lvbu", "subordinate", 0.5, {}),
    ("lvbu", "dongzhuo_p", "enemy", 1.0, {"note": "诛董卓"}),
    ("wangyun", "dongzhuo_p", "enemy", 1.0, {}),
    ("diaochan", "wangyun", "family", 0.9, {"relation": "义父女"}),

    # 同盟
    ("liubei", "sunquan", "ally", 0.9, {"note": "赤壁同盟"}),
    ("sunquan", "liubei", "ally", 0.9, {}),
    ("caocao", "yuanshao_p", "rival", 0.8, {"note": "早年共讨董卓"}),

    # 兵器持有
    ("guanyu", "qinglong", "holds", 1.0, {}),
    ("zhangfei", "shemao", "holds", 1.0, {}),
    ("liubei", "shuanggu", "holds", 1.0, {}),
    ("lvbu", "fangtian", "holds", 1.0, {}),
    ("guanyu", "chitu", "owns", 1.0, {}),
    ("liubei", "dilu", "owns", 1.0, {}),
    ("zhugeliang", "muniu", "owns", 0.8, {}),
    ("sunjian", "yuxi", "owns", 0.7, {}),

    # 人物参与事件
    ("zhangjiao", "huangjin", "participated", 1.0, {}),
    ("liubei", "taoyuan", "participated", 1.0, {}),
    ("guanyu", "taoyuan", "participated", 1.0, {}),
    ("zhangfei", "taoyuan", "participated", 1.0, {}),
    ("liubei", "sanying", "participated", 1.0, {}),
    ("guanyu", "sanying", "participated", 1.0, {}),
    ("zhangfei", "sanying", "participated", 1.0, {}),
    ("lvbu", "sanying", "participated", 1.0, {}),
    ("caocao", "guandu_b", "participated", 1.0, {}),
    ("yuanshao_p", "guandu_b", "participated", 1.0, {}),
    ("guanyu", "qianli", "participated", 1.0, {}),
    ("caocao", "chibi_b", "participated", 1.0, {}),
    ("liubei", "chibi_b", "participated", 1.0, {}),
    ("sunquan", "chibi_b", "participated", 1.0, {}),
    ("zhouyu", "chibi_b", "participated", 1.0, {}),
    ("zhugeliang", "chibi_b", "participated", 1.0, {}),
    ("huanggai", "chibi_b", "participated", 1.0, {}),
    ("liubei", "sangu", "participated", 1.0, {}),
    ("zhugeliang", "sangu", "participated", 1.0, {}),
    ("zhugeliang", "caochuan", "participated", 1.0, {}),
    ("zhugeliang", "jieDongfeng", "participated", 1.0, {}),
    ("guanyu", "huarong", "participated", 1.0, {}),
    ("caocao", "huarong", "participated", 1.0, {}),
    ("guanyu", "shuimang", "participated", 1.0, {}),
    ("yujin", "shuimang", "participated", 1.0, {}),
    ("lvmeng", "baiyi", "participated", 1.0, {}),
    ("guanyu", "maicheng_b", "participated", 1.0, {}),
    ("liubei", "yiling_b", "participated", 1.0, {}),
    ("luxun", "yiling_b", "participated", 1.0, {}),
    ("liubei", "tuogu", "participated", 1.0, {}),
    ("zhugeliang", "tuogu", "participated", 1.0, {}),
    ("zhugeliang", "chutian", "participated", 1.0, {}),
    ("masu", "jieTing", "participated", 1.0, {}),
    ("zhugeliang", "jieTing", "participated", 1.0, {}),
    ("zhanghe", "jieTing", "participated", 1.0, {}),
    ("zhugeliang", "wuzhang_b", "participated", 1.0, {}),
    ("zhugeliang", "qiji", "participated", 1.0, {}),
    ("meng获", "qiji", "participated", 1.0, {}),
    ("dengai", "mieshu", "participated", 1.0, {}),
    ("liushan", "mieshu", "participated", 1.0, {}),
    ("dongzhuo_p", "dongzhuo_ru", "participated", 1.0, {}),
    ("wangyun", "lianhuan", "participated", 1.0, {}),
    ("diaochan", "lianhuan", "participated", 1.0, {}),
    ("lvbu", "lianhuan", "participated", 1.0, {}),
    ("lvbu", "xiapeip", "participated", 1.0, {}),
    ("caocao", "xiapeip", "participated", 1.0, {}),
    ("huangzhong", "dingjun", "participated", 1.0, {}),
    ("xiahouyuan", "dingjun", "participated", 1.0, {}),
    ("guanyu", "dandao", "participated", 1.0, {}),
    ("lusu", "dandao", "participated", 1.0, {}),
    ("caocao", "zhujiulun", "participated", 1.0, {}),
    ("liubei", "zhujiulun", "participated", 1.0, {}),
    ("huaxiong", "luoyang_dong", "participated", 1.0, {}),
    ("guanyu", "luoyang_dong", "participated", 1.0, {}),

    # 事件地点
    ("huangjin", "luoyang", "located_at", 0.8, {}),
    ("taoyuan", "xinye", "located_at", 0.6, {}),
    ("sanying", "hulaoguan", "located_at", 1.0, {}),
    ("guandu_b", "guandu", "located_at", 1.0, {}),
    ("chibi_b", "chibi", "located_at", 1.0, {}),
    ("sangu", "xinye", "located_at", 1.0, {}),
    ("yiling_b", "yiling", "located_at", 1.0, {}),
    ("tuogu", "baidi", "located_at", 1.0, {}),
    ("jieTing", "jiating", "located_at", 1.0, {}),
    ("wuzhang_b", "wuzhangyuan", "located_at", 1.0, {}),
    ("maicheng_b", "maicheng", "located_at", 1.0, {}),
    ("xiapeip", "xiapi", "located_at", 1.0, {}),
    ("dingjun", "dingjunshan", "located_at", 1.0, {}),
    ("dongzhuo_ru", "luoyang", "located_at", 1.0, {}),
    ("qiji", "nanzhong", "located_at", 1.0, {}),
    ("shuimang", "fancheng", "located_at", 1.0, {}),

    # 事件因果链
    ("huangjin", "taoyuan", "followed_by", 0.7, {}),
    ("dongzhuo_ru", "lianhuan", "followed_by", 0.9, {}),
    ("lianhuan", "guandu_b", "followed_by", 0.5, {}),
    ("guandu_b", "chibi_b", "followed_by", 0.8, {}),
    ("sangu", "chibi_b", "followed_by", 0.7, {}),
    ("chibi_b", "shuimang", "followed_by", 0.6, {}),
    ("shuimang", "baiyi", "followed_by", 0.9, {}),
    ("baiyi", "maicheng_b", "caused", 1.0, {}),
    ("maicheng_b", "yiling_b", "followed_by", 0.9, {}),
    ("yiling_b", "tuogu", "followed_by", 0.9, {}),
    ("tuogu", "chutian", "followed_by", 0.8, {}),
    ("chutian", "jieTing", "followed_by", 0.7, {}),
    ("jieTing", "wuzhang_b", "followed_by", 0.6, {}),
    ("wuzhang_b", "mieshu", "followed_by", 0.5, {}),
    ("mieshu", "miewu", "followed_by", 0.9, {}),

    # 人物与地点
    ("liubei", "chengdu", "located_at", 0.8, {}),
    ("caocao", "xuchang", "located_at", 0.8, {}),
    ("sunquan", "jianye", "located_at", 0.8, {}),
    ("guanyu", "jiangling", "located_at", 0.7, {}),
    ("xiandi", "xuchang", "located_at", 0.7, {}),
    ("dongzhuo_p", "changan", "located_at", 0.7, {}),
    ("yuanshao_p", "ye", "located_at", 0.8, {}),
]
