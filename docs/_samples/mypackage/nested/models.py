"""入れ子パッケージ内のモデル定義。

基底クラス付きのクラス解析例です。
"""


class Entity:
    """識別子を持つ基底エンティティ。"""

    id: int

    def __init__(self, entity_id: int) -> None:
        """エンティティを初期化する。

        Args:
            entity_id: 一意な識別子。
        """
        self.id = entity_id


class User(Entity):
    """表示名を持つユーザー。

    Args:
        entity_id: 一意な識別子。
        name: 表示名。
    """

    name: str

    def __init__(self, entity_id: int, name: str) -> None:
        """ユーザーを初期化する。

        Args:
            entity_id: 一意な識別子。
            name: 表示名。
        """
        super().__init__(entity_id)
        self.name = name

    def label(self) -> str:
        """表示用ラベルを返す。

        Returns:
            `id:name` 形式の文字列。
        """
        return f"{self.id}:{self.name}"
