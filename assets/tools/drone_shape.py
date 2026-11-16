"""The drone body's shape, shared by drone_build.py and drone_role_kit.py so parts sit on the surface.

Drone space: face +X, up +Z. The body is a slightly squashed sphere: a surface of revolution round Z
with radius RX across, half-height RZ (90% of RX, per the redesign spec) and profile exponent P (2 = ellipse,
higher = flatter top and sides).
"""
import math

from mathutils import Vector

C = Vector((0.0, 0.0, -0.05))
RX, RZ, P = 0.335, 0.30, 2.0


def _pw(x, e):
    return math.copysign(abs(x) ** e, x)


def profile(phi):
    """(r, z) of the surface at latitude phi (radians), relative to C."""
    return RX * _pw(math.cos(phi), 2 / P), RZ * _pw(math.sin(phi), 2 / P)


def at(phi, az, lift=0.0):
    """Surface point at latitude/azimuth, pushed `lift` along the surface normal."""
    r, z = profile(phi)
    p = C + Vector((r * math.cos(az), r * math.sin(az), z))
    return p + normal(p) * lift


def normal(p):
    d = p - C
    r = math.hypot(d.x, d.y)
    dr = P * r ** (P - 1) / RX ** P
    dz = P * _pw(d.z, P - 1) / RZ ** P
    if r < 1e-9:
        return Vector((0, 0, math.copysign(1, d.z)))
    return Vector((dr * d.x / r, dr * d.y / r, dz)).normalized()


def toward(direction, lift=0.0):
    """Surface point in a direction from C, pushed `lift` along the normal."""
    d = Vector(direction).normalized()
    t = ((math.hypot(d.x, d.y) / RX) ** P + (abs(d.z) / RZ) ** P) ** (-1 / P)
    p = C + d * t
    return p + normal(p) * lift


def surface_z(x, y):
    """Height of the top surface above (x, y)."""
    rho = math.hypot(x, y)
    return C.z + RZ * max(0.0, 1 - (rho / RX) ** P) ** (1 / P)
