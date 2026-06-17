# 导入示例：三国演义

| 文件 | 作用 |
|------|------|
| `scripts/sanguo_data.py` | 137 实体 + 177 关系 |
| `scripts/seed_sanguo.py` | 薄封装，内部调用 `import_world.py` |

```bash
cd scripts && python3 import_world.py sanguo_data
# 或
cd scripts && python3 seed_sanguo.py
```

服务器：

```bash
ssh nec "cd ~/worldbuilder/scripts && \
  WORLDBUILDER_API=http://localhost:8090/api python3 import_world.py sanguo_data"
```

新建世界观：复制 `sanguo_data.py` → `myworld_data.py`，填好后 `python3 import_world.py myworld_data`。
