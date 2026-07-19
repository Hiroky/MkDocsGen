"""Example module for pydoc tests.

This module demonstrates Google-style docstrings.
"""

from typing import Optional


class Greeter:
    """Greet users.

    Note:
        Keep messages short.
    """

    count: int

    def __init__(self, name: str) -> None:
        """Create a greeter.

        Args:
            name: Person name.
        """
        self._name = name

    @property
    def name(self) -> str:
        """Return the person name."""
        return self._name

    @classmethod
    def from_default(cls) -> "Greeter":
        """Build with a default name."""
        return cls("world")

    @staticmethod
    def shout(text: str) -> str:
        """Uppercase text.

        Args:
            text (str): Input text.

        Returns:
            Uppercased text.

        Raises:
            ValueError: If text is empty.

        Examples:
            >>> Greeter.shout("hi")
            'HI'

        Warning:
            Loud output.
        """
        if not text:
            raise ValueError("empty")
        return text.upper()

    def _secret(self) -> None:
        """Private method."""
        return None


def greet(name: str, times: int = 1) -> str:
    """Greet someone.

    Args:
        name: Person to greet.
        times: Repeat count.

    Returns:
        Greeting message.

    Yields:
        Not used here, but documented for parser coverage.
    """
    return ("Hello, " + name + "! ") * times


def _hidden() -> None:
    """Should be excluded when show-private is false."""
    pass
