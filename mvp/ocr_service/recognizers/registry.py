"""Recognizer registry and factory.

Phase-1 contract (locked):

- The registry stores recognizer CLASSES (not instances).
  This keeps it lightweight and lets callers defer the cost of
  model loads / object construction until the recognizer is
  actually selected for use.

- register(name, RecognizerClass) adds a class under a stable
  string name. Names are unique service-wide.

- resolve(name) returns the class so the caller can instantiate it.

- all() returns the registered classes in insertion order, for
  introspection / debugging.

This module deliberately does NOT include dispatch helpers
(no `pick_for`, no `DispatchingRecognizer`). The caller is
responsible for selecting which recognizer class to instantiate
and pass into `pipeline.run_pipeline(recognizer=...)`. The
registry's only job is bookkeeping: store classes by name,
look them up, iterate them.

Phase-2 client usage:
    registry = build_default_registry()
    recognizer_class = registry.resolve("trocr")
    recognizer = recognizer_class()      # instantiate here, models stay lazy
    result = run_pipeline(image_bgr, master_key, recognizer=recognizer)
"""

from __future__ import annotations

from .base import Recognizer


class RecognizerRegistry:
    """Owns the set of registered Recognizer classes."""

    def __init__(self) -> None:
        # name -> Recognizer subclass
        self._by_name: dict[str, type[Recognizer]] = {}
        # parallel list preserves insertion order for deterministic iteration
        self._ordered: list[type[Recognizer]] = []

    def register(self, name: str, recognizer_class: type[Recognizer]) -> None:
        """Register a Recognizer subclass under a stable string name.

        Parameters
        ----------
        name : str
            Stable identifier used by `resolve`. Must be non-empty
            and unique within this registry.
        recognizer_class : type[Recognizer]
            A concrete subclass of Recognizer. Must not already be
            registered under a different name.

        Raises
        ------
        ValueError
            If `name` is empty or already registered.
        TypeError
            If `recognizer_class` is not a Recognizer subclass.
        """
        if not name:
            raise ValueError("name must be non-empty")
        if not isinstance(recognizer_class, type) or not issubclass(
            recognizer_class, Recognizer
        ):
            raise TypeError(
                f"{recognizer_class!r} must be a subclass of Recognizer"
            )
        if name in self._by_name:
            raise ValueError(f"Duplicate recognizer name: {name!r}")
        self._by_name[name] = recognizer_class
        self._ordered.append(recognizer_class)

    def resolve(self, name: str) -> type[Recognizer]:
        """Return the Recognizer subclass registered under `name`.

        Raises
        ------
        KeyError
            If `name` is not registered.
        """
        if name not in self._by_name:
            raise KeyError(f"Unknown recognizer: {name!r}")
        return self._by_name[name]

    def all(self) -> list[type[Recognizer]]:
        """Return all registered Recognizer subclasses in insertion order."""
        return list(self._ordered)


def build_default_registry() -> RecognizerRegistry:
    """Construct the default registry.

    Imports are lazy where needed so this module itself remains
    side-effect free at import time. Stub is always available;
    TrOCR is registered only when its dependencies (torch,
    transformers) are importable. If `requirements-ocr.txt` has
    not been installed, the TrOCR class import will raise
    ImportError and we silently skip it — the registry will
    contain only the stub.
    """
    from .stub import StubRecognizer

    registry = RecognizerRegistry()
    registry.register("stub", StubRecognizer)

    try:
        from .trocr import TrOcrRecognizer
        registry.register("trocr", TrOcrRecognizer)
    except ImportError:
        # torch / transformers not installed — TrOCR unavailable.
        # Caller is expected to handle the resulting KeyError when
        # resolving "trocr" (or to not request it).
        pass

    return registry