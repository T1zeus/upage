import { createScopedLogger } from '~/.server/utils/logger';
import { prisma } from './prisma';

const logger = createScopedLogger('page.server');

/**
 * 根据消息ID获取页面
 * @param messageId 消息ID
 * @returns 页面记录
 *
 * @deprecated 旧版 Page 表，仅作为 PageV2 不存在时的回退查询；新代码请使用 getPageV2ByMessageId
 */
export async function getPageByMessageId(messageId: string) {
  try {
    const page = await prisma.page.findUnique({
      where: { messageId },
    });

    return page;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    logger.error(`获取消息 ${messageId} 的页面失败: ${errorMessage}`);
    throw error;
  }
}
