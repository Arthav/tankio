# Tankio2 Context

This context defines project-specific gameplay language used by the shared simulation, server, and Phaser client.

## Language

**Shape**:
A farmable arena object, including square, triangle, pentagon, and alpha pentagon.
_Avoid_: Block, obstacle

**Combat Feedback**:
A visual-only response to authoritative combat events, with no damage, physics, XP, or progression effect.
_Avoid_: Damage event, combat balance

**Body Impact**:
Visual feedback from a tank-body collision against a shape or another player.
_Avoid_: Crash damage, ram balance

**Tank Dex**:
A browsable in-game reference for tank classes, upgrade requirements, and playstyle.
_Avoid_: Tank Dictionary, Tank Catalog

**Ability**:
A tank-specific special behavior or playstyle modifier, such as invisibility, drone control, or auto turrets.
_Avoid_: Boost
