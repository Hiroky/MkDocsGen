---
name: refactor
description: 外部ふるまいを変えずにコード構造を改善するリファクタリングスキル。冗長コードの削減・関数の抽出・命名改善・型安全性向上・デザインパターン適用などを扱う。「コードを綺麗にして」「リファクタしたい」「重複を減らしたい」などの要求に応用する。
license: MIT
---

# リファクタリングスキル

## 概要

このスキルは、外部ふるまいを変えずにコード構造・可読性・保守性を改善するためのガイドラインです。
リファクタリングは革命ではなく「漸進的な進化」です。一度に大きく変えず、小さな改善を積み重ねます。

---

## 最重要原則：冗長コードの撲滅

冗長コードはすべての技術的負債の根源です。以下の順序で最優先に対処します。

### ❶ コピー＆ペーストの重複（最悪）

同じロジックが複数箇所に存在する状態。バグ修正・仕様変更のたびに全箇所を修正する必要があり、修正漏れが発生しやすい。

```diff
# 悪い例：同じ割引計算が2箇所に散在
- function calculateUserDiscount(user) {
-   if (user.membership === 'gold') return user.total * 0.2;
-   if (user.membership === 'silver') return user.total * 0.1;
-   return 0;
- }
-
- function calculateOrderDiscount(order) {
-   if (order.user.membership === 'gold') return order.total * 0.2;
-   if (order.user.membership === 'silver') return order.total * 0.1;
-   return 0;
- }

# 良い例：共通ロジックを1箇所に集約
+ const MEMBERSHIP_DISCOUNT_RATES: Record<string, number> = {
+   gold: 0.2,
+   silver: 0.1,
+ };
+
+ function getMembershipDiscountRate(membership: string): number {
+   return MEMBERSHIP_DISCOUNT_RATES[membership] ?? 0;
+ }
+
+ function calculateUserDiscount(user: User): number {
+   return user.total * getMembershipDiscountRate(user.membership);
+ }
+
+ function calculateOrderDiscount(order: Order): number {
+   return order.total * getMembershipDiscountRate(order.user.membership);
+ }
```

**判断基準**: 同じコードが2箇所以上あったら必ず共通化する（Rule of Three）。

---

### ❷ 条件分岐の冗長な繰り返し

同じ条件を何度も評価する、または似たような条件ブロックが並んでいる状態。

```diff
# 悪い例：同じ条件チェックが散在
- function processUser(user) {
-   if (user.role === 'admin') {
-     sendAdminEmail(user);
-   }
-   if (user.role === 'admin') {
-     grantAdminPermissions(user);
-   }
-   if (user.role === 'admin') {
-     logAdminAccess(user);
-   }
- }

# 良い例：条件を1回だけ評価
+ function processUser(user: User): void {
+   if (user.role !== 'admin') return;
+   sendAdminEmail(user);
+   grantAdminPermissions(user);
+   logAdminAccess(user);
+ }
```

```diff
# 悪い例：似た構造のswitch/ifが複数箇所に存在
- function getLabel(status) {
-   if (status === 'active') return 'アクティブ';
-   if (status === 'inactive') return '非アクティブ';
-   if (status === 'suspended') return '停止中';
- }
-
- function getColor(status) {
-   if (status === 'active') return 'green';
-   if (status === 'inactive') return 'gray';
-   if (status === 'suspended') return 'red';
- }

# 良い例：データで表現し、分岐を1箇所に集約
+ const STATUS_CONFIG = {
+   active:    { label: 'アクティブ',  color: 'green' },
+   inactive:  { label: '非アクティブ', color: 'gray' },
+   suspended: { label: '停止中',      color: 'red' },
+ } as const;
+
+ function getStatusConfig(status: keyof typeof STATUS_CONFIG) {
+   return STATUS_CONFIG[status];
+ }
```

---

### ❸ 死んだコード（Dead Code）

実行されない・参照されないコードは積極的に削除します。Git に履歴があるため消しても復元できます。

```diff
# 悪い例：コメントアウト・未使用のコードが残留
- function oldImplementation() { /* ... */ }
- const DEPRECATED_VALUE = 5;
- import { unusedThing } from './somewhere';
- // function legacyProcess() {
- //   return doSomething();
- // }

# 良い例：迷わず削除する
+ // 何も残さない。Git で追える。
```

**チェックリスト**:
- [ ] コメントアウトされたコードブロックが残っていないか
- [ ] 未使用のインポートが残っていないか
- [ ] 未使用の変数・関数・クラスが残っていないか
- [ ] 到達不能なコードパス（`return`後のコード等）が残っていないか

---

### ❹ マジックナンバー・マジック文字列

値の意味が名前から読み取れない状態。変更時に全箇所を把握しにくく、バグの温床になる。

```diff
# 悪い例：数値・文字列がコードに直接埋め込まれている
- if (user.status === 2) { /* ... */ }
- const discount = total * 0.15;
- setTimeout(callback, 86400000);

# 良い例：名前付き定数で意味を明示
+ const UserStatus = {
+   ACTIVE: 1,
+   INACTIVE: 2,
+   SUSPENDED: 3,
+ } as const;
+
+ const DISCOUNT_RATES = {
+   STANDARD: 0.1,
+   PREMIUM: 0.15,
+   VIP: 0.2,
+ } as const;
+
+ const ONE_DAY_MS = 24 * 60 * 60 * 1000;
+
+ if (user.status === UserStatus.INACTIVE) { /* ... */ }
+ const discount = total * DISCOUNT_RATES.PREMIUM;
+ setTimeout(callback, ONE_DAY_MS);
```

---

## よくあるコードの臭いと対処法

### 肥大化した関数（Long Method）

1つの関数が複数の責務を持ち、50行を超えている状態。

```diff
# 悪い例：すべてを1関数に詰め込む
- async function processOrder(orderId) {
-   // 50行: 注文取得
-   // 30行: バリデーション
-   // 40行: 価格計算
-   // 30行: 在庫更新
-   // 20行: 配送作成
-   // 30行: 通知送信
- }

# 良い例：責務ごとに関数を分割
+ async function processOrder(orderId: string) {
+   const order = await fetchOrder(orderId);
+   validateOrder(order);
+   const pricing = calculatePricing(order);
+   await updateInventory(order);
+   const shipment = await createShipment(order);
+   await sendNotifications(order, pricing, shipment);
+   return { order, pricing, shipment };
+ }
```

**目安**: 関数は「1つのことだけ」行い、理想は20行以内、最大50行を超えない。

---

### 神クラス（God Object）

1つのクラスが何でも知っていて何でもやっている状態。

```diff
# 悪い例：何でも屋のクラス
- class UserManager {
-   createUser() { /* ... */ }
-   sendEmail() { /* ... */ }
-   generateReport() { /* ... */ }
-   handlePayment() { /* ... */ }
-   // 50個以上のメソッド...
- }

# 良い例：単一責任に分割
+ class UserService {
+   create(data: UserData) { /* ... */ }
+   update(id: string, data: Partial<UserData>) { /* ... */ }
+   delete(id: string) { /* ... */ }
+ }
+
+ class EmailService {
+   send(to: string, subject: string, body: string) { /* ... */ }
+ }
+
+ class ReportService {
+   generate(type: ReportType, params: ReportParams) { /* ... */ }
+ }
```

---

### パラメータ過多（Long Parameter List）

引数が3つを超え始めたら、関連するものをまとめるシグナル。

```diff
# 悪い例：引数が多すぎる
- function createUser(email, password, name, age, address, city, country, phone) {
-   /* ... */
- }

# 良い例：関連パラメータをオブジェクトにまとめる
+ interface CreateUserInput {
+   email: string;
+   password: string;
+   name: string;
+   age?: number;
+   address?: Address;
+   phone?: string;
+ }
+
+ function createUser(input: CreateUserInput) {
+   /* ... */
+ }
```

---

### ネストした条件分岐（Nested Conditionals）

ネストが深くなるほど読みにくく、テストも難しくなる。ガード節で早期リターンすることで解消する。

```diff
# 悪い例：右肩上がりの矢印コード
- function process(order) {
-   if (order) {
-     if (order.user) {
-       if (order.user.isActive) {
-         if (order.total > 0) {
-           return processOrder(order);
-         } else {
-           return { error: '金額が不正です' };
-         }
-       } else {
-         return { error: 'ユーザーが無効です' };
-       }
-     } else {
-       return { error: 'ユーザーが存在しません' };
-     }
-   } else {
-     return { error: '注文が存在しません' };
-   }
- }

# 良い例：ガード節で早期リターン
+ function process(order: Order) {
+   if (!order)             return { error: '注文が存在しません' };
+   if (!order.user)        return { error: 'ユーザーが存在しません' };
+   if (!order.user.isActive) return { error: 'ユーザーが無効です' };
+   if (order.total <= 0)   return { error: '金額が不正です' };
+   return processOrder(order);
+ }
```

---

### 過度な親密さ（Inappropriate Intimacy）

あるクラスが別クラスの内部実装を深く知っている状態。カプセル化が壊れており、変更時に広範囲に影響が及ぶ。

```diff
# 悪い例：他クラスの内部に深く入り込む
- class OrderProcessor {
-   process(order) {
-     const street = order.user.profile.address.street;   // 深すぎる
-     order.repository.connection.config.host;             // カプセル化違反
-   }
- }

# 良い例：オブジェクト自身に振る舞いを持たせる（Tell, Don't Ask）
+ class OrderProcessor {
+   process(order: Order) {
+     const address = order.getShippingAddress(); // Orderが責任を持つ
+     order.save();                               // Orderが保存責任を持つ
+   }
+ }
```

---

### 機能の羨望（Feature Envy）

あるメソッドが、自分のクラスより他クラスのデータを多用している状態。ロジックは「データのオーナー」に移動させる。

```diff
# 悪い例：OrderがUserのデータを直接操作
- class Order {
-   calculateDiscount(user: User) {
-     if (user.membershipLevel === 'gold') return this.total * 0.2;
-     if (user.accountAge > 365) return this.total * 0.1;
-     return 0;
-   }
- }

# 良い例：ロジックをUserに移動
+ class User {
+   getDiscountRate(): number {
+     if (this.membershipLevel === 'gold') return 0.2;
+     if (this.accountAge > 365) return 0.1;
+     return 0;
+   }
+ }
+
+ class Order {
+   calculateDiscount(user: User): number {
+     return this.total * user.getDiscountRate();
+   }
+ }
```

---

### プリミティブ執着（Primitive Obsession）

ドメイン概念をプリミティブ型（string/number）で表現し続けている状態。ドメインオブジェクトに昇格させることでバリデーションと意味が一箇所に集まる。

```diff
# 悪い例：emailをstringとして扱い続ける
- function sendEmail(to: string, subject: string, body: string) { /* ... */ }
- sendEmail('invalid-email', '件名', '本文'); // バリデーションが漏れる

# 良い例：ドメインオブジェクト化
+ class Email {
+   private constructor(public readonly value: string) {}
+
+   static create(value: string): Email {
+     if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
+       throw new Error('メールアドレスの形式が不正です');
+     }
+     return new Email(value);
+   }
+ }
+
+ function sendEmail(to: Email, subject: string, body: string) { /* ... */ }
```

---

## リファクタリングに使うデザインパターン

### Strategyパターン：条件分岐をクラスに置き換える

```diff
# 悪い例：送料計算の条件分岐
- function calculateShipping(order, method) {
-   if (method === 'standard') return order.total > 50 ? 0 : 5.99;
-   if (method === 'express')  return order.total > 100 ? 9.99 : 14.99;
-   if (method === 'overnight') return 29.99;
- }

# 良い例：Strategyパターンで拡張しやすく
+ interface ShippingStrategy {
+   calculate(order: Order): number;
+ }
+
+ class StandardShipping implements ShippingStrategy {
+   calculate(order: Order) { return order.total > 50 ? 0 : 5.99; }
+ }
+
+ class ExpressShipping implements ShippingStrategy {
+   calculate(order: Order) { return order.total > 100 ? 9.99 : 14.99; }
+ }
+
+ class OvernightShipping implements ShippingStrategy {
+   calculate(_order: Order) { return 29.99; }
+ }
+
+ function calculateShipping(order: Order, strategy: ShippingStrategy): number {
+   return strategy.calculate(order);
+ }
```

**メリット**: 新しい送料方法を追加しても既存コードを変更しない（開放/閉鎖原則）。

---

### Null Objectパターン：null チェックの冗長を排除

```diff
# 悪い例：null チェックが至るところに散在
- function renderUser(user) {
-   if (user) {
-     return user.name;
-   } else {
-     return 'ゲスト';
-   }
- }
- function getAvatar(user) {
-   return user ? user.avatar : DEFAULT_AVATAR;
- }

# 良い例：Null Objectで分岐をなくす
+ class GuestUser implements User {
+   name = 'ゲスト';
+   avatar = DEFAULT_AVATAR;
+   isGuest = true;
+ }
+
+ // 以降、null チェック不要
+ function renderUser(user: User) { return user.name; }
+ function getAvatar(user: User)  { return user.avatar; }
```

---

## 型安全性の向上

型を強化することで、コンパイル時に多くのバグを検出できるようになる。

```diff
# 悪い例：any型・曖昧な型
- function calculateDiscount(user, total, membership, date) {
-   if (membership === 'gold' && date.getDay() === 5) return total * 0.25;
-   if (membership === 'gold') return total * 0.2;
-   return total * 0.1;
- }

# 良い例：型を明示し、戻り値も型で表現
+ type Membership = 'bronze' | 'silver' | 'gold';
+
+ interface DiscountResult {
+   original: number;
+   discount: number;
+   final: number;
+   rate: number;
+ }
+
+ function calculateDiscount(
+   user: User,
+   total: number,
+   date: Date = new Date()
+ ): DiscountResult {
+   if (total < 0) throw new Error('金額は0以上である必要があります');
+   const rate = user.membership === 'gold' && date.getDay() === 5 ? 0.25
+               : user.membership === 'gold'   ? 0.2
+               : user.membership === 'silver' ? 0.15
+               : 0.1;
+   return { original: total, discount: total * rate, final: total * (1 - rate), rate };
+ }
```

---

## リファクタリングの進め方

```
1. 準備
   - テストが存在することを確認（なければ先に書く）
   - 現状をコミット
   - フィーチャーブランチを作成

2. 特定
   - 対象のコードスメルを1つ選ぶ
   - コードが何をしているか理解する
   - リファクタリング方針を決める

3. 実施（小さなステップで）
   - 1つの変更を加える
   - テストを実行する
   - テストが通ったらコミット
   - 繰り返す

4. 検証
   - すべてのテストが通ること
   - パフォーマンスが劣化していないこと
   - 手動テストで動作確認

5. 完了
   - 関連コメント・ドキュメントを更新
   - 最終コミット
```

---

## リファクタリング完了チェックリスト

### 冗長コード（最重要）
- [ ] 同一・類似のロジックが2箇所以上に存在しない
- [ ] コメントアウトされたコードブロックが残っていない
- [ ] 未使用のインポート・変数・関数が残っていない
- [ ] マジックナンバー・マジック文字列が定数化されている
- [ ] 同じ条件分岐が複数回評価されていない

### コード構造
- [ ] 関数が1つのことだけ行っている（理想20行以内、最大50行）
- [ ] クラスが単一責任を持っている
- [ ] 関連するコードがまとまっている
- [ ] 依存関係が一方向に流れている（循環依存がない）

### 型安全性
- [ ] 公開APIにすべて型が定義されている
- [ ] `any` 型に正当な理由がある
- [ ] null/undefined が明示的に扱われている

### テスト
- [ ] リファクタリング後もすべてのテストが通る
- [ ] エッジケースがカバーされている

---

## 主なリファクタリング操作一覧

| 操作 | 説明 |
|------|------|
| メソッドの抽出 | コードの断片をメソッドに切り出す |
| クラスの抽出 | 責務をもとに新クラスに分離する |
| インターフェースの抽出 | 実装からインターフェースを定義する |
| メソッドのインライン化 | 過剰に分割されたメソッドを呼び出し元に戻す |
| パラメータオブジェクトの導入 | 関連する引数をオブジェクトにまとめる |
| 条件をポリモーフィズムに置換 | switch/ifをStrategyパターンに変える |
| マジック値を定数に置換 | 意味のある名前付き定数に変える |
| ガード節を使ったネスト解消 | 早期リターンでネストを平坦化する |
| Null Objectの導入 | null チェックを排除する |
| 継承を委譲に置換 | 継承よりコンポジションを使う |
| 型コードをクラス/Enumに置換 | 文字列・数値の型コードを強型化する |
