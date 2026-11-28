"""The key-value store under concurrent writes (request 22: a 500 on a kv write in the browser
suite, WinError 5 replacing '<key>.tmp' while a second write of the same key held it)."""
import threading

from jarvis_app import germoney as g


def test_many_writers_of_one_key_and_of_many_keys_never_collide(tmp_path):
    # Two instances on one folder, as the server and the sandbox seed build them, plus readers:
    # on Windows a reader's open handle is what makes a replace fail.
    a = g.KVStore(tmp_path / "kv", tmp_path / "bk")
    b = g.KVStore(tmp_path / "kv", tmp_path / "bk")
    errors: list[BaseException] = []
    written = {"@shared": set(), **{f"@k{i}": set() for i in range(4)}}
    start = threading.Barrier(16)

    def writer(store, n):
        try:
            start.wait()
            for j in range(40):
                v = f"w{n}-{j}"
                written["@shared"].add(v)
                store.set("@shared", v)
                k = f"@k{n % 4}"
                written[k].add(v)
                store.set(k, v)
        except BaseException as e:      # noqa: BLE001 - the test collects every failure
            errors.append(e)

    def reader(store):
        try:
            start.wait()
            for _ in range(200):
                store.get("@shared")
                store.get("@k0")
        except BaseException as e:      # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=writer, args=(a if n % 2 else b, n)) for n in range(12)]
    threads += [threading.Thread(target=reader, args=(a if n % 2 else b,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    for key, values in written.items():
        assert a.get(key) in values
    assert list((tmp_path / "kv").glob("*.tmp")) == []
    assert list((tmp_path / "kv").glob(".*.tmp")) == []
    assert sorted(a.keys()) == sorted(written)


def test_a_junction_to_the_same_folder_shares_the_lock(tmp_path):
    import os
    import pytest
    real = tmp_path / "kv"
    real.mkdir()
    link = tmp_path / "kv-link"
    try:
        import _winapi
        _winapi.CreateJunction(str(real), str(link))
    except (ImportError, OSError):
        try:
            os.symlink(real, link, target_is_directory=True)
        except OSError:
            pytest.skip("no junction or symlink can be made here")
    try:
        assert g.KVStore(real, tmp_path / "bk")._lock is g.KVStore(link, tmp_path / "bk")._lock
    finally:
        os.rmdir(link)                               # removes the junction itself, never the folder it points at
