"""Extract character / weapon / artifact data from a gcsim checkout into JSON.

Usage:
    python -I scripts/extract_gcsim.py <path-to-gcsim-repo> src/data/gcsim.json

Only reads files; nothing from the gcsim repo is executed. Go expressions are
evaluated with a tiny arithmetic-only evaluator.
"""

import ast
import json
import os
import re
import sys

import yaml

ACTIONS = {
    "InvalidAction": "_",
    "ActionSkill": "skill",
    "ActionBurst": "burst",
    "ActionAttack": "attack",
    "ActionCharge": "charge",
    "ActionHighPlunge": "high_plunge",
    "ActionLowPlunge": "low_plunge",
    "ActionAim": "aim",
    "ActionDash": "dash",
    "ActionJump": "jump",
    "ActionSwap": "swap",
    "ActionWalk": "walk",
}

ELEMENTS = {
    "Fire": "pyro", "Water": "hydro", "Wind": "anemo", "Electric": "electro",
    "Grass": "dendro", "Ice": "cryo", "Rock": "geo",
}

WEAPON_CLASS = {
    "WEAPON_SWORD_ONE_HAND": "sword", "WEAPON_CLAYMORE": "claymore",
    "WEAPON_POLE": "polearm", "WEAPON_BOW": "bow", "WEAPON_CATALYST": "catalyst",
}

PROP_TO_STAT = {
    "FIGHT_PROP_CRITICAL": "cr",
    "FIGHT_PROP_CRITICAL_HURT": "cd",
    "FIGHT_PROP_ATTACK_PERCENT": "atk%",
    "FIGHT_PROP_HP_PERCENT": "hp%",
    "FIGHT_PROP_DEFENSE_PERCENT": "def%",
    "FIGHT_PROP_CHARGE_EFFICIENCY": "er",
    "FIGHT_PROP_ELEMENT_MASTERY": "em",
    "FIGHT_PROP_PHYSICAL_ADD_HURT": "phys%",
    "FIGHT_PROP_HEAL_ADD": "heal",
    "FIGHT_PROP_FIRE_ADD_HURT": "pyro%",
    "FIGHT_PROP_WATER_ADD_HURT": "hydro%",
    "FIGHT_PROP_WIND_ADD_HURT": "anemo%",
    "FIGHT_PROP_ELEC_ADD_HURT": "electro%",
    "FIGHT_PROP_GRASS_ADD_HURT": "dendro%",
    "FIGHT_PROP_ICE_ADD_HURT": "cryo%",
    "FIGHT_PROP_ROCK_ADD_HURT": "geo%",
}


# ---------------------------------------------------------------- arithmetic

class Unresolved(Exception):
    pass


def safe_eval(expr, consts, depth=0):
    """Evaluate a Go arithmetic expression; identifiers resolve via consts."""
    if depth > 20:
        raise Unresolved(expr)
    expr = expr.strip()
    expr = re.sub(r"\bfloat64\(", "(", expr)
    expr = re.sub(r"\bint\(", "(", expr)
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        raise Unresolved(expr)

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -ev(node.operand)
        if isinstance(node, ast.BinOp):
            a, b = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Add):
                return a + b
            if isinstance(node.op, ast.Sub):
                return a - b
            if isinstance(node.op, ast.Mult):
                return a * b
            if isinstance(node.op, ast.Div):
                return a / b
        if isinstance(node, ast.Name):
            if node.id in consts:
                v = consts[node.id]
                if isinstance(v, str):
                    return safe_eval(v, consts, depth + 1)
                return v
            raise Unresolved(node.id)
        if isinstance(node, ast.Subscript):
            base = ev(node.value)
            idx = ev(node.slice)
            if isinstance(base, list) and isinstance(idx, int) and 0 <= idx < len(base):
                return base[idx]
            raise Unresolved(expr)
        raise Unresolved(expr)

    return ev(tree)


def try_eval(expr, consts):
    try:
        v = safe_eval(expr, consts)
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        return v
    except (Unresolved, ZeroDivisionError, TypeError, RecursionError):
        return None


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"//[^\n]*", "", src)


def read_go_package(dirpath):
    out = []
    for fn in sorted(os.listdir(dirpath)):
        if fn.endswith(".go") and not fn.endswith("_test.go") and not fn.startswith("zz_"):
            with open(os.path.join(dirpath, fn), encoding="utf8") as f:
                out.append(strip_comments(f.read()))
    return "\n".join(out)


LITERAL_RE = re.compile(r"^(?:\[\]+[\w.]+)+\s*(\{.*\})$", re.S)


def collect_consts(src):
    consts = {}
    # string constants are stored with a \x00 prefix so they never evaluate as numbers
    for m in re.finditer(r"^\s*(?:const\s+)?([A-Za-z_]\w*)\s*(?:string\s*)?=\s*\"([^\"\n]+)\"", src, flags=re.M):
        consts.setdefault(m.group(1), "\x00" + m.group(2))
    for m in re.finditer(
        r"^\s*(?:const\s+|var\s+)?([A-Za-z_]\w*)\s*(?:int|float64)?\s*(?::=|=)\s*([^\n]+)$",
        src, flags=re.M,
    ):
        name, expr = m.group(1), m.group(2).strip()
        if name in consts:
            continue
        lit = LITERAL_RE.match(expr)
        if lit:
            body = lit.group(1)
            if body.count("{") != body.count("}"):
                continue
            try:
                consts[name] = ast.literal_eval(body.replace("{", "[").replace("}", "]"))
            except (ValueError, SyntaxError):
                pass
            continue
        if re.fullmatch(r"[\w\s.*+\-/()\[\]]+", expr) and not re.search(r"\.[A-Za-z_]", expr):
            consts[name] = expr
    # multi-line composite literals: name = [][]int{ ... }
    for m in re.finditer(r"([A-Za-z_]\w*)\s*=\s*((?:\[\])+(?:int|float64)\s*\{)", src):
        name = m.group(1)
        if name in consts and not isinstance(consts[name], str):
            continue
        start = m.end() - 1
        depth, i = 0, start
        while i < len(src):
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = src[start:i + 1]
        body = re.sub(r"(?:\[\])+(?:int|float64)", "", body)
        try:
            consts[name] = ast.literal_eval(body.replace("{", "[").replace("}", "]"))
        except (ValueError, SyntaxError):
            pass
    return consts


# ---------------------------------------------------------------- frames

FRAME_INIT_RE = re.compile(
    r"^\s*([A-Za-z_]\w*Frames)((?:\[[^\]\n]+\])*)\s*=\s*frames\.(InitAbilSlice|InitNormalCancelSlice)\(([^\n]*)\)\s*$",
    re.M,
)
FRAME_SET_RE = re.compile(
    r"^\s*([A-Za-z_]\w*Frames)((?:\[[^\]\n]+\])*)\[action\.(\w+)\]\s*=\s*([^\n]+?)\s*$",
    re.M,
)


def split_args(s):
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts]


def index_key(idx_str, consts):
    idxs = re.findall(r"\[([^\]]+)\]", idx_str)
    out = []
    for i in idxs:
        v = try_eval(i, consts)
        if v is None:
            return None
        out.append(str(v))
    return out


def extract_frames(src, consts):
    slices = {}
    events = []
    for m in FRAME_INIT_RE.finditer(src):
        events.append((m.start(), "init", m))
    for m in FRAME_SET_RE.finditer(src):
        events.append((m.start(), "set", m))
    events.sort(key=lambda e: e[0])
    for _, kind, m in events:
        name = m.group(1)
        idx = index_key(m.group(2), consts)
        if idx is None:
            continue
        key = name + "".join("[" + i + "]" for i in idx)
        if kind == "init":
            args = split_args(m.group(4))
            if m.group(3) == "InitAbilSlice":
                v = try_eval(args[0], consts)
                if v is None:
                    continue
                slices[key] = {a: v for a in ACTIONS.values()}
            else:
                if len(args) != 2:
                    continue
                h, a = try_eval(args[0], consts), try_eval(args[1], consts)
                if h is None or a is None:
                    continue
                s = {x: a for x in ACTIONS.values()}
                for x in ("aim", "skill", "burst", "dash", "jump", "swap"):
                    s[x] = h
                slices[key] = s
        else:
            act = ACTIONS.get(m.group(3))
            if act is None or key not in slices:
                continue
            v = try_eval(m.group(4), consts)
            if v is not None:
                slices[key][act] = v
    # compress: store default + overrides
    out = {}
    for k, s in slices.items():
        d = s["_"]
        out[k] = {"_": d, **{a: v for a, v in s.items() if a != "_" and v != d}}
    return out


SKIP_STATUS = re.compile(r"icd|particle|debounce|delay|lockout|energy|cd$|-cd|_cd", re.I)


def extract_statuses(code_dir, consts):
    """Statuses/modifiers applied from skill*.go / burst*.go with a fixed duration."""
    out = []
    seen = set()
    for fn in sorted(os.listdir(code_dir)):
        if not fn.endswith(".go") or fn.endswith("_test.go"):
            continue
        src_kind = "skill" if fn.startswith("skill") else "burst" if fn.startswith("burst") else None
        if not src_kind:
            continue
        with open(os.path.join(code_dir, fn), encoding="utf8") as f:
            src = strip_comments(f.read())
        pats = [
            r"AddStatus\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,",
            r"NewBase(?:WithHitlag)?\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)",
        ]
        for pat in pats:
            for m in re.finditer(pat, src):
                name_expr, dur_expr = m.group(1), m.group(2)
                if name_expr.startswith('"'):
                    name = name_expr.strip('"')
                else:
                    name = consts.get(name_expr)
                    if not isinstance(name, str) or not name.startswith("\x00"):
                        continue
                    name = name[1:]
                if SKIP_STATUS.search(name) or (name, src_kind) in seen:
                    continue
                dur = try_eval(dur_expr, consts)
                if not isinstance(dur, (int, float)) or dur < 60 or dur > 60 * 60:
                    continue
                seen.add((name, src_kind))
                out.append({"name": name, "on": src_kind, "dur": round(dur / 60, 2)})
    return out


def extract_cds(src, consts):
    res = {"skill": [], "burst": []}
    for m in re.finditer(r"SetCD(?:WithDelay)?\(action\.Action(Skill|Burst),\s*", src):
        rest = src[m.end():m.end() + 200]
        args = split_args(rest[: rest.find("\n")].rstrip().rstrip(")").rstrip())
        if not args:
            continue
        expr = args[0]
        # unbalanced trailing paren from greedy line slice
        while expr.count(")") > expr.count("("):
            expr = expr[: expr.rfind(")")]
        v = try_eval(expr, consts)
        if isinstance(v, (int, float)) and v > 0:
            sec = round(v / 60, 2)
            lst = res[m.group(1).lower()]
            if sec not in lst:
                lst.append(sec)
    charges = 1
    m = re.search(r"SetNumCharges\(action\.ActionSkill,\s*(\d+)\)", src)
    if m:
        charges = int(m.group(1))
    return res, charges


# ---------------------------------------------------------------- catalog (Go)

def parse_curves(path):
    with open(path, encoding="utf8") as f:
        src = f.read()
    curves = {}
    for m in re.finditer(r"GrowCurveType_(\w+):\s*\{([^}]*)\}", src):
        vals = [float(x) for x in re.findall(r"[\d.]+", m.group(2))]
        curves[m.group(1)] = vals
    return curves


def catalog_blocks(src):
    starts = [m for m in re.finditer(r"^\tkeys\.(\w+):\s*\{", src, flags=re.M)]
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(src)
        yield m.group(1), src[m.start():end]


def last_promo_props(block):
    promos = block.split("MaxLevel:")
    last = promos[-1]
    props = {}
    for pm in re.finditer(r"PropType:\s*model\.FightPropType_(\w+),\s*Value:\s*([-\d.e]+)", last):
        props[pm.group(1)] = float(pm.group(2))
    return props


def parse_char_catalog(path, curves):
    with open(path, encoding="utf8") as f:
        src = f.read()
    out = {}
    for _, block in catalog_blocks(src):
        km = re.search(r'Key:\s*"(\w+)"', block)
        if not km:
            continue
        key = km.group(1)

        def num(name):
            m = re.search(name + r":\s*([-\d.e]+)", block)
            return float(m.group(1)) if m else 0.0

        def curve(name):
            m = re.search(name + r":\s*model\.GrowCurveType_(\w+)", block)
            return curves.get(m.group(1), [1.0] * 100)[89] if m else 1.0

        promo = last_promo_props(block)
        base = {
            "hp": num("BaseHp") * curve("HpCurve") + promo.get("FIGHT_PROP_BASE_HP", 0),
            "atk": num("BaseAtk") * curve("AtkCurve") + promo.get("FIGHT_PROP_BASE_ATTACK", 0),
            "def": num("BaseDef") * curve("DefCruve") + promo.get("FIGHT_PROP_BASE_DEFENSE", 0),
        }
        asc = {}
        for p, v in promo.items():
            if p in PROP_TO_STAT:
                asc[PROP_TO_STAT[p]] = round(v, 4)
        out[key] = {"base": {k: round(v, 2) for k, v in base.items()}, "asc": asc}
    return out


def parse_weapon_catalog(path, curves):
    with open(path, encoding="utf8") as f:
        src = f.read()
    out = {}
    for _, block in catalog_blocks(src):
        km = re.search(r'Key:\s*"(\w+)"', block)
        if not km:
            continue
        key = km.group(1)
        rarity = int(re.search(r"Rarity:\s*(\d)", block).group(1))
        wc = re.search(r"WeaponClass:\s*model\.WeaponType_(\w+)", block)
        stats = {}
        for pm in re.finditer(
            r"PropType:\s*model\.FightPropType_(\w+),\s*InitialValue:\s*([-\d.e]+),\s*Curve:\s*model\.GrowCurveType_(\w+)",
            block,
        ):
            prop, init, cv = pm.group(1), float(pm.group(2)), pm.group(3)
            v = init * curves.get(cv, [1.0] * 100)[89]
            if prop == "FIGHT_PROP_BASE_ATTACK":
                stats["atk"] = v
            elif prop in PROP_TO_STAT:
                stats[PROP_TO_STAT[prop]] = v
        promo = last_promo_props(block)
        stats["atk"] = stats.get("atk", 0) + promo.get("FIGHT_PROP_BASE_ATTACK", 0)
        out[key] = {
            "rarity": rarity,
            "type": WEAPON_CLASS.get(wc.group(1) if wc else "", "sword"),
            "stats": {k: round(v, 4) for k, v in stats.items()},
        }
    return out


def parse_shortcuts(path):
    with open(path, encoding="utf8") as f:
        src = f.read()
    m = {}
    for a, k in re.findall(r'"(\w+)":\s*keys\.(\w+),', src):
        m.setdefault(k, []).append(a)
    return m


def go_key_names(path):
    """Map Go enum ident (e.g. RaidenShogun) -> key string (raidenshogun)."""
    with open(path, encoding="utf8") as f:
        src = f.read()
    return {ident: s for ident, s in re.findall(r"^\t(\w+)\s+(?:\w+\s+=\s+iota\s+)?//\s*(\w+)", src, flags=re.M)}


# ---------------------------------------------------------------- yaml configs

def load_yaml(path):
    with open(path, encoding="utf8") as f:
        return yaml.safe_load(f) or {}


def ability_params(cfg):
    out = {}
    for ab in cfg.get("abilities") or []:
        if ab.get("params"):
            out[ab["name"]] = {k: str(v) for k, v in ab["params"].items()}
    notes = {}
    for ab in cfg.get("abilities") or []:
        if ab.get("note"):
            notes[ab["name"]] = str(ab["note"])
    return out, notes


def find_configs(root, kind):
    res = []
    for dp, _, files in os.walk(root):
        if "config.yml" in files:
            cfg = load_yaml(os.path.join(dp, "config.yml"))
            if cfg.get("kind") == kind:
                res.append((dp, cfg))
    return res


def main():
    gc, out_path = sys.argv[1], sys.argv[2]
    data_dir = os.path.join(gc, "ui", "packages", "ui", "src", "data")
    with open(os.path.join(data_dir, "character.dm.json"), encoding="utf8") as f:
        char_dm = json.load(f)["data"]
    with open(os.path.join(data_dir, "weapon.dm.json"), encoding="utf8") as f:
        weapon_dm = json.load(f)["data"]
    with open(os.path.join(gc, "ui", "packages", "localization", "src", "locales", "names.dm.json"), encoding="utf8") as f:
        names = json.load(f)["English"]

    curves = parse_curves(os.path.join(gc, "pkg", "catalog", "curve.dm.go"))
    char_cat = parse_char_catalog(os.path.join(gc, "pkg", "catalog", "character.dm.go"), curves)
    weap_cat = parse_weapon_catalog(os.path.join(gc, "pkg", "catalog", "weapon.dm.go"), curves)
    char_alias = parse_shortcuts(os.path.join(gc, "pkg", "shortcut", "character.dm.go"))
    char_ident = go_key_names(os.path.join(gc, "pkg", "core", "keys", "character.dm.go"))
    alias_by_key = {char_ident.get(ident, ident.lower()): al for ident, al in char_alias.items()}

    def aliases_for(kind):
        al = parse_shortcuts(os.path.join(gc, "pkg", "shortcut", f"{kind}.dm.go"))
        ident = go_key_names(os.path.join(gc, "pkg", "core", "keys", f"{kind}.dm.go"))
        return {ident.get(i, i.lower()): sorted(set(a)) for i, a in al.items()}

    weapon_alias = aliases_for("weapon")
    set_alias = aliases_for("artifact")

    # ---- characters
    chars_root = os.path.join(gc, "internal", "characters")
    characters = []
    for dp, cfg in find_configs(chars_root, "character"):
        key = cfg["name"]
        dm = char_dm.get(key)
        if not dm:
            continue
        rel = os.path.relpath(dp, chars_root).replace("\\", "/").split("/")
        if rel[0] == "traveler":
            code_dir = os.path.join(chars_root, "traveler", "common", rel[1])
            folder = "traveler" + rel[1]
        else:
            code_dir = dp
            folder = rel[0]
        src = read_go_package(code_dir)
        consts = collect_consts(src)
        frames = extract_frames(src, consts)
        cds, charges = extract_cds(src, consts)
        statuses = extract_statuses(code_dir, consts)
        params, notes = ability_params(cfg)
        aliases = alias_by_key.get(key, [key])
        # prefer the folder name (e.g. "raiden", "kazuha") when it is a valid alias
        cfg_key = folder if folder in aliases else (min(aliases, key=len) if rel[0] != "traveler" else key)
        if rel[0] == "traveler":
            cfg_key = key
        cat = char_cat.get(key, {"base": {}, "asc": {}})
        characters.append({
            "key": cfg_key,
            "id": key,
            "name": names["character_names"].get(key, key),
            "element": ELEMENTS.get(dm["element"], "physical"),
            "weapon": WEAPON_CLASS.get(dm["weapon_class"], "sword"),
            "rarity": 5 if dm["rarity"] == "QUALITY_ORANGE" else 4,
            "energy": dm.get("skill_details", {}).get("burst_energy_cost", 0),
            "aliases": sorted(set(aliases)),
            "base": cat["base"],
            "asc": cat["asc"],
            "skillCD": cds["skill"],
            "burstCD": cds["burst"],
            "skillCharges": charges,
            "params": params,
            "notes": notes,
            "frames": frames,
            "statuses": statuses,
        })
    characters.sort(key=lambda c: c["name"])

    # ---- weapons
    weapons = []
    for dp, cfg in find_configs(os.path.join(gc, "internal", "weapons"), "weapon"):
        key = cfg["name"]
        dm = weapon_dm.get(key)
        cat = weap_cat.get(key)
        if not dm or not cat:
            continue
        params, _ = ability_params(cfg)
        weapons.append({
            "key": key,
            "name": names["weapon_names"].get(key, key),
            "type": cat["type"],
            "rarity": cat["rarity"],
            "stats": cat["stats"],
            "params": params.get("default", {}),
            "aliases": weapon_alias.get(key, [key]),
        })
    weapons.sort(key=lambda w: (-w["rarity"], w["name"]))

    # ---- artifacts
    sets = []
    for dp, cfg in find_configs(os.path.join(gc, "internal", "artifacts"), "artifact"):
        key = cfg["name"]
        params, _ = ability_params(cfg)
        sets.append({
            "key": key,
            "name": names["artifact_names"].get(key, key),
            "params": params.get("default", {}),
            "aliases": set_alias.get(key, [key]),
        })
    sets.sort(key=lambda s: s["name"])

    # artifact main stat values by rarity -> GOOD stat key -> level (used by the GOOD importer)
    with open(os.path.join(data_dir, "artifact_main_gen.json"), encoding="utf8") as f:
        artifact_main = json.load(f)

    with open(out_path, "w", encoding="utf8") as f:
        json.dump(
            {"characters": characters, "weapons": weapons, "sets": sets, "artifactMain": artifact_main},
            f, ensure_ascii=False, separators=(",", ":"),
        )
    print(f"characters={len(characters)} weapons={len(weapons)} sets={len(sets)} -> {out_path}")


if __name__ == "__main__":
    main()
