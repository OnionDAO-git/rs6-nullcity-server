#!/bin/sh
# Container entrypoint for Railway deployments.
# Seeds the persistent data volume on first boot, templates server-config.json
# from environment variables, then execs the role-appropriate node process.
set -e

ROLE="${SERVICE_ROLE:-game}"

DATA_DIR="${DATA_DIR:-/usr/src/app/data}"
SEED_DIR="${SEED_DIR:-/usr/src/app/data-seed}"
CONFIG_DIR="${CONFIG_DIR:-/usr/src/app/config}"

# Seed the volume from the baked-in data-seed on first boot.
# `cp -rn` preserves any state already written by previous runs.
if [ -d "$SEED_DIR" ] && [ ! -f "$DATA_DIR/.seeded" ]; then
    echo "[entrypoint] seeding $DATA_DIR from $SEED_DIR"
    mkdir -p "$DATA_DIR"
    cp -rn "$SEED_DIR/." "$DATA_DIR/" || true
    touch "$DATA_DIR/.seeded"
fi

mkdir -p "$DATA_DIR/saves" "$CONFIG_DIR"

# --- server-config.json defaults ---
: "${HOST:=0.0.0.0}"
: "${GAME_PORT:=43594}"
: "${LOGIN_SERVER_HOST:=0.0.0.0}"
: "${LOGIN_SERVER_PORT:=43591}"
: "${UPDATE_SERVER_HOST:=0.0.0.0}"
: "${UPDATE_SERVER_PORT:=43592}"
: "${RSA_MOD:=119568088839203297999728368933573315070738693395974011872885408638642676871679245723887367232256427712869170521351089799352546294030059890127723509653145359924771433131004387212857375068629466435244653901851504845054452735390701003613803443469723435116497545687393297329052988014281948392136928774011011998343}"
: "${RSA_EXP:=12747337179295870166838611986189126026507945904720545965726999254744592875817063488911622974072289858092633084100280214658532446654378876853112046049506789703022033047774294965255097838909779899992870910011426403494610880634275141204442441976355383839981584149269550057129306515912021704593400378690444280161}"
: "${ENCRYPTION_ENABLED:=true}"
: "${EXP_RATE:=1}"
: "${SHOW_WELCOME:=true}"
: "${GIVE_ACHIEVEMENTS:=true}"
: "${CHECK_CREDENTIALS:=true}"
: "${TUTORIAL_ENABLED:=false}"
: "${ADMIN_DROPS_ENABLED:=true}"
: "${LOADED_ZONE_SCALE:=1}"
: "${BYPASS_TELEPORT_REQUIREMENTS:=false}"
: "${PLAYER_SAVE_PATH:=$DATA_DIR/saves}"

: "${AGENT_GATEWAY_ENABLED:=false}"
: "${AGENT_GATEWAY_HOST:=$HOST}"
: "${AGENT_GATEWAY_PORT:=43595}"
: "${AGENT_GATEWAY_AUTH_TOKEN:=}"
: "${AGENT_GATEWAY_ALLOW_DELETE:=false}"
: "${AGENT_GATEWAY_AUTOSAVE_TICKS:=1000}"

# RSA values must be JSON-quoted (they are arbitrary-precision ints transmitted as strings).
cat > "$CONFIG_DIR/server-config.json" <<EOF
{
    "configDir": "./config",
    "cacheDir": "./cache",
    "host": "${HOST}",
    "port": ${GAME_PORT},
    "updateServerHost": "${UPDATE_SERVER_HOST}",
    "updateServerPort": ${UPDATE_SERVER_PORT},
    "loginServerHost": "${LOGIN_SERVER_HOST}",
    "loginServerPort": ${LOGIN_SERVER_PORT},
    "rsaMod": "${RSA_MOD}",
    "rsaExp": "${RSA_EXP}",
    "encryptionEnabled": ${ENCRYPTION_ENABLED},
    "playerSavePath": "${PLAYER_SAVE_PATH}",
    "showWelcome": ${SHOW_WELCOME},
    "expRate": ${EXP_RATE},
    "giveAchievements": ${GIVE_ACHIEVEMENTS},
    "checkCredentials": ${CHECK_CREDENTIALS},
    "tutorialEnabled": ${TUTORIAL_ENABLED},
    "adminDropsEnabled": ${ADMIN_DROPS_ENABLED},
    "loadedZoneScale": ${LOADED_ZONE_SCALE},
    "bypassTeleportRequirements": ${BYPASS_TELEPORT_REQUIREMENTS},
    "agentGateway": {
        "enabled": ${AGENT_GATEWAY_ENABLED},
        "host": "${AGENT_GATEWAY_HOST}",
        "port": ${AGENT_GATEWAY_PORT},
        "authToken": "${AGENT_GATEWAY_AUTH_TOKEN}",
        "allowDelete": ${AGENT_GATEWAY_ALLOW_DELETE},
        "autosaveTicks": ${AGENT_GATEWAY_AUTOSAVE_TICKS}
    }
}
EOF

echo "[entrypoint] role=$ROLE host=$HOST game=$GAME_PORT login=$LOGIN_SERVER_HOST:$LOGIN_SERVER_PORT update=$UPDATE_SERVER_HOST:$UPDATE_SERVER_PORT"

case "$ROLE" in
    game)
        exec node --max-old-space-size="${NODE_MAX_OLD_SPACE:-2048}" dist/server/runner.js -- -game
        ;;
    login)
        exec node --max-old-space-size="${NODE_MAX_OLD_SPACE:-1024}" dist/server/runner.js -- -login
        ;;
    update)
        exec node --max-old-space-size="${NODE_MAX_OLD_SPACE:-1024}" dist/server/runner.js -- -update
        ;;
    *)
        echo "[entrypoint] unknown SERVICE_ROLE: $ROLE (expected game | login | update)" >&2
        exit 1
        ;;
esac
