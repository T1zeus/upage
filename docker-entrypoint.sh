#!/bin/bash
set -eo pipefail

SCRIPT_NAME=$(basename "$0")
START_TIME=$(date +%s)
MAX_DB_RETRIES=10
DB_RETRY_INTERVAL=5
TEMP_FILES=()

cleanup() {
  log_info "正在清理资源..."

  for temp_file in "${TEMP_FILES[@]}"; do
    if [[ -f "$temp_file" ]]; then
      rm -f "$temp_file"
      log_debug "已删除临时文件: $temp_file"
    fi
  done

  log_info "清理完成"
}

handle_exit() {
  log_info "接收到退出信号，正在退出..."
  cleanup
  exit 0
}

trap handle_exit SIGTERM SIGINT
trap cleanup EXIT

LOG_LEVEL_DEBUG=0
LOG_LEVEL_INFO=1
LOG_LEVEL_WARN=2
LOG_LEVEL_ERROR=3
CURRENT_LOG_LEVEL=${LOG_LEVEL_INFO}

if [[ "$LOG_LEVEL" == "debug" ]]; then
  CURRENT_LOG_LEVEL=${LOG_LEVEL_DEBUG}
elif [[ "$LOG_LEVEL" == "info" ]]; then
  CURRENT_LOG_LEVEL=${LOG_LEVEL_INFO}
elif [[ "$LOG_LEVEL" == "warn" ]]; then
  CURRENT_LOG_LEVEL=${LOG_LEVEL_WARN}
elif [[ "$LOG_LEVEL" == "error" ]]; then
  CURRENT_LOG_LEVEL=${LOG_LEVEL_ERROR}
fi

log_debug() {
  if [[ ${CURRENT_LOG_LEVEL} -le ${LOG_LEVEL_DEBUG} ]]; then
    echo "🔍 [$(date '+%Y-%m-%d %H:%M:%S')] [DEBUG] $*"
  fi
}

log_info() {
  if [[ ${CURRENT_LOG_LEVEL} -le ${LOG_LEVEL_INFO} ]]; then
    echo "ℹ️ [$(date '+%Y-%m-%d %H:%M:%S')] [INFO] $*"
  fi
}

log_warn() {
  if [[ ${CURRENT_LOG_LEVEL} -le ${LOG_LEVEL_WARN} ]]; then
    echo "⚠️ [$(date '+%Y-%m-%d %H:%M:%S')] [WARN] $*"
  fi
}

log_error() {
  if [[ ${CURRENT_LOG_LEVEL} -le ${LOG_LEVEL_ERROR} ]]; then
    echo "❌ [$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] $*"
  fi
}

log_success() {
  if [[ ${CURRENT_LOG_LEVEL} -le ${LOG_LEVEL_INFO} ]]; then
    echo "✅ [$(date '+%Y-%m-%d %H:%M:%S')] [SUCCESS] $*"
  fi
}

# 创建安全的临时文件
create_temp_file() {
  local temp_file
  temp_file=$(mktemp)
  TEMP_FILES+=("$temp_file")
  echo "$temp_file"
}

# 校验数据库连接串是否已配置（不打印内容，避免泄露凭据）
require_database_url() {
  if [[ -z "$DATABASE_URL" ]]; then
    log_error "未设置 DATABASE_URL 环境变量，无法连接 PostgreSQL"
    return 1
  fi
  return 0
}

# 探测数据库连通性：通过 Prisma 执行一次轻量 SELECT 1
probe_db_connection() {
  echo "SELECT 1;" | pnpm prisma db execute --stdin --schema=./prisma/schema.prisma > /dev/null 2>&1
}

# 等待 PostgreSQL 就绪（带重试）
wait_for_db() {
  log_info "等待 PostgreSQL 数据库就绪..."

  if ! require_database_url; then
    return 1
  fi

  local attempt=1
  while (( attempt <= MAX_DB_RETRIES )); do
    if probe_db_connection; then
      log_success "PostgreSQL 数据库连接成功（第 ${attempt} 次尝试）"
      return 0
    fi

    log_warn "第 ${attempt}/${MAX_DB_RETRIES} 次连接失败，${DB_RETRY_INTERVAL}s 后重试..."
    sleep "$DB_RETRY_INTERVAL"
    (( attempt++ ))
  done

  log_error "在 ${MAX_DB_RETRIES} 次尝试后仍无法连接 PostgreSQL"
  return 1
}

# 处理数据库迁移
handle_db_migration() {
  log_info "处理数据库迁移..."

  # 1. 尝试直接应用迁移
  local migrate_output
  migrate_output=$(create_temp_file)

  log_info "尝试应用数据库迁移..."
  if pnpm prisma migrate deploy --schema=./prisma/schema.prisma > "$migrate_output" 2>&1; then
    log_success "数据库迁移成功应用"
    return 0
  fi

  if grep -q "P3005" "$migrate_output" || grep -q "数据库架构不为空" "$migrate_output"; then
    log_warn "检测到已存在的数据库结构，需要应用 baseline..."

    local migration_dirs
    migration_dirs=$(find prisma/migrations -maxdepth 1 -type d | grep -v "^prisma/migrations$" | sort)

    if [[ -z "$migration_dirs" ]]; then
      log_warn "未找到迁移，跳过 baseline 处理"
    else
      log_info "找到以下迁移:"

      for migration_dir in $migration_dirs; do
        local migration_name
        migration_name=$(basename "$migration_dir")
        log_info "  - $migration_name"

        log_info "将迁移 $migration_name 标记为已应用..."
        local resolve_output
        resolve_output=$(create_temp_file)

        if ! pnpm prisma migrate resolve --applied "$migration_name" > "$resolve_output" 2>&1; then
          log_warn "标记迁移 $migration_name 时出错:"
          cat "$resolve_output"
        fi
      done

      log_success "Baseline 应用成功"

      log_info "检查并应用新的迁移..."
      local deploy_output
      deploy_output=$(create_temp_file)

      if ! pnpm prisma migrate deploy > "$deploy_output" 2>&1; then
        log_warn "应用新迁移时出错:"
        cat "$deploy_output"

        log_info "尝试使用 db push 作为备选方案..."
        local push_output
        push_output=$(create_temp_file)

        if ! pnpm prisma db push --accept-data-loss --skip-generate > "$push_output" 2>&1; then
          log_error "使用 db push 也失败了:"
          cat "$push_output"
          return 1
        else
          log_success "使用 db push 成功应用架构"
        fi
      else
        log_success "新迁移应用成功"
      fi
    fi
  else
    log_warn "迁移失败，错误信息:"
    cat "$migrate_output"

    log_info "尝试使用 db push 作为备选方案..."
    local push_output
    push_output=$(create_temp_file)

    if ! pnpm prisma db push --accept-data-loss --skip-generate > "$push_output" 2>&1; then
      log_error "使用 db push 也失败了:"
      cat "$push_output"
      return 1
    else
      log_success "使用 db push 成功应用架构"
    fi
  fi

  return 0
}

main() {
  log_info "🚀 启动 UPage 应用..."

  log_info "系统环境信息:"
  log_info "  - NODE_ENV: $NODE_ENV"
  log_info "  - 当前用户: $(whoami)"
  log_info "  - 工作目录: $(pwd)"

  if ! wait_for_db; then
    log_error "数据库连接失败，退出启动流程"
    exit 1
  fi

  if ! handle_db_migration; then
    log_error "数据库迁移失败，退出启动流程"
    exit 1
  fi

  local end_time
  end_time=$(date +%s)
  local duration=$((end_time - START_TIME))

  log_success "初始化完成，耗时 ${duration} 秒"
  log_info "启动应用服务..."

  log_info "执行命令: $*"
  exec "$@"
}

main "$@"
