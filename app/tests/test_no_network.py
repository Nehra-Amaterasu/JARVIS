"""The test run itself cannot reach the LAN or the running app (conftest.py guard)."""
import socket

import pytest


@pytest.mark.parametrize("addr", [("192.168.1.23", 4210), ("8.8.8.8", 53), ("127.0.0.1", 8777)])
def test_a_connect_outside_loopback_or_to_the_live_app_fails(addr):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        with pytest.raises(OSError, match="tests never touch the network|running JARVIS app"):
            s.connect(addr)
    finally:
        s.close()


def test_a_udp_datagram_to_the_lan_fails():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        with pytest.raises(OSError, match="tests never touch the network"):
            s.sendto(b"HELLO", ("192.168.1.50", 3333))
    finally:
        s.close()


def test_loopback_still_works():
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    c = socket.socket()
    try:
        c.connect(srv.getsockname())               # what the phone-listener tests do
    finally:
        c.close()
        srv.close()
