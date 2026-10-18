-- 奶山羊养殖场管理系统 数据库结构
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============ 用户与权限 ============
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  full_name     TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'keeper',   -- admin/keeper/finance
  phone         TEXT    DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  must_change   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL,
  last_login_at TEXT
);

-- ============ 账户 ============
-- kind: cash 现金 / bank 银行 / wechat 微信 / alipay 支付宝 / receivable 应收 / payable 应付 / other 其他
-- sign: 余额 = 期初 + sign * (收入 - 支出)
CREATE TABLE IF NOT EXISTS accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE,
  kind            TEXT    NOT NULL DEFAULT 'cash',
  sign            INTEGER NOT NULL DEFAULT 1,
  opening_balance REAL    NOT NULL DEFAULT 0,
  opening_date    TEXT    NOT NULL,
  note            TEXT    DEFAULT '',
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL
);

-- ============ 收支科目 ============
-- affect=1 计入损益(利润表)；affect=0 仅资金/往来变动(往来款、借款、内部转账、折旧冲回等)
CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL,
  kind      TEXT    NOT NULL,                       -- income 收入 / expense 支出
  group_name TEXT   NOT NULL DEFAULT '其他',
  affect    INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 99,
  active    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (name, kind)
);

-- ============ 出入账流水 ============
CREATE TABLE IF NOT EXISTS txn (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  biz_date      TEXT    NOT NULL,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  direction     TEXT    NOT NULL,                   -- income 收 / expense 支
  amount        REAL    NOT NULL CHECK (amount > 0),
  affect        INTEGER NOT NULL DEFAULT 1,
  counterparty  TEXT    DEFAULT '',
  note          TEXT    DEFAULT '',
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  link_type     TEXT    DEFAULT '',                 -- milk 奶款自动生成 / sale 卖羊款自动生成 / transfer 对转
  link_id       INTEGER,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_date    ON txn (biz_date);
CREATE INDEX IF NOT EXISTS idx_txn_account ON txn (account_id, biz_date);
CREATE INDEX IF NOT EXISTS idx_txn_cat     ON txn (category_id);

-- ============ 羊只个体档案 ============
-- sex: f 母 / m 公
-- status:在场 alive / 已售 sold / 死亡 dead / 淘汰 cull / 外借 loan
CREATE TABLE IF NOT EXISTS goat (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_no        TEXT    NOT NULL UNIQUE,            -- 耳标号
  name          TEXT    DEFAULT '',
  sex           TEXT    NOT NULL DEFAULT 'f',
  breed         TEXT    DEFAULT '萨能奶山羊',
  birth_date    TEXT    NOT NULL,
  birth_weight  REAL,
  source        TEXT    DEFAULT '',                 -- 自繁/外购/赠送
  buy_price     REAL    DEFAULT 0,
  sire_tag      TEXT    DEFAULT '',
  dam_tag       TEXT    DEFAULT '',
  barn          TEXT    DEFAULT '',
  first_kidding TEXT,                                -- 首次产羔日期，用于区分经产/青年母羊
  milk_role     TEXT    DEFAULT '',                 -- 主力/备用/干奶
  status        TEXT    NOT NULL DEFAULT 'alive',
  status_date   TEXT,
  exit_reason   TEXT    DEFAULT '',
  exit_price    REAL    DEFAULT 0,
  weaned_date   TEXT,
  note          TEXT    DEFAULT '',
  created_at    TEXT    NOT NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_goat_status ON goat (status, status_date);
CREATE INDEX IF NOT EXISTS idx_goat_birth  ON goat (birth_date);
CREATE INDEX IF NOT EXISTS idx_goat_sex    ON goat (sex, status);

-- ============ 羊只事件流水（存栏变动 + 生产记录）========
-- type: birth 出生 / purchase 购入 / sale 售出 / death 死亡 / cull 淘汰 / loan_out 外借
--       transfer 转群 / weigh 称重 / vaccine 防疫 / treat 治疗 / breed 配种
--       kidding 产羔 / wean 断奶 / milk_dry 干奶 / note 备注
CREATE TABLE IF NOT EXISTS goat_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  goat_id     INTEGER NOT NULL REFERENCES goat(id) ON DELETE CASCADE,
  event_date  TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  barn        TEXT    DEFAULT '',
  weight      REAL,
  amount      REAL    DEFAULT 0,
  milk_qty    REAL,                                 -- 产羔时当日产奶
  batch       TEXT    DEFAULT '',
  note        TEXT    DEFAULT '',
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gev_goat ON goat_event (goat_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_gev_date ON goat_event (event_date, type);

-- ============ 产奶记录 ============
-- batch: 生鲜奶 / 巴氏奶 / 酸奶 / 奶酪 / 乳饮料
CREATE TABLE IF NOT EXISTS milk (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  biz_date    TEXT    NOT NULL,
  group_code  TEXT    NOT NULL DEFAULT '全群',        -- 泌乳分组：经产群/育成群/新产群
  batch       TEXT    NOT NULL DEFAULT '生鲜奶',
  weight_kg   REAL    NOT NULL CHECK (weight_kg >= 0),
  discard_kg  REAL    NOT NULL DEFAULT 0,           -- 弃奶(乳房炎/药残)
  price       REAL    NOT NULL DEFAULT 0,
  amount      REAL    NOT NULL DEFAULT 0,
  grade       TEXT    DEFAULT '',
  shift       TEXT    DEFAULT '早/晚',
  note        TEXT    DEFAULT '',
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milk_date  ON milk (biz_date);
CREATE INDEX IF NOT EXISTS idx_milk_batch ON milk (batch, biz_date);

-- ============ 系统设置 ============
CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
