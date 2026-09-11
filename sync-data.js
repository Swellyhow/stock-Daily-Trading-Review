#!/usr/bin/env node

/**
 * 市场数据同步命令行工具
 * 使用方法：node sync-data.js [命令] [参数]
 */

import marketSync from './src/lib/collector/market-sync.js';
import scheduler from './src/lib/collector/market-scheduler.js';
import marketDatabase from './src/lib/collector/market-database.js';

const commands = {
  // 同步今日数据
  'sync-today': async () => {
    console.log('📊 同步今日市场数据...\n');
    const result = await marketSync.syncDailyMarketData();

    if (result.success) {
      console.log('\n✅ 同步成功！');
      console.log(`日期: ${result.date}`);
      console.log(`涨停池: ${result.limitUpCount} 只`);
      console.log(`跌停池: ${result.limitDownCount} 只`);
      console.log(`板块: ${result.sectorCount} 个`);
      console.log(`指数: ${result.indexCount} 个`);
    } else {
      console.error('\n❌ 同步失败:', result.error);
    }
  },

  // 同步指定日期数据
  'sync-date': async (date) => {
    if (!date) {
      console.error('❌ 请提供日期参数，格式: YYYY-MM-DD');
      console.log('示例: node sync-data.js sync-date 2026-04-26');
      return;
    }

    console.log(`📊 同步 ${date} 市场数据...\n`);
    const result = await marketSync.syncDailyMarketData(date);

    if (result.success) {
      console.log('\n✅ 同步成功！');
      console.log(`实际日期: ${result.date}`);
      console.log(`涨停池: ${result.limitUpCount} 只`);
      console.log(`跌停池: ${result.limitDownCount} 只`);
    } else {
      console.error('\n❌ 同步失败:', result.error);
    }
  },

  // 同步最近N天
  'sync-recent': async (days = 7) => {
    const numDays = parseInt(days) || 7;
    console.log(`📊 同步最近 ${numDays} 天数据...\n`);

    const results = await marketSync.syncRecentDays(numDays);
    const successCount = results.filter(r => r.success).length;

    console.log(`\n✅ 完成: ${successCount}/${numDays} 天同步成功`);
  },

  // 同步个股K线
  'sync-kline': async (code, limit = 100) => {
    if (!code) {
      console.error('❌ 请提供股票代码');
      console.log('示例: node sync-data.js sync-kline 000001 100');
      return;
    }

    console.log(`📈 同步 ${code} K线数据...\n`);
    const result = await marketSync.syncStockKline(code, { limit: parseInt(limit) });

    if (result.success) {
      console.log('\n✅ 同步成功！');
      console.log(`股票: ${result.code}`);
      console.log(`数据量: ${result.count} 条`);
      if (result.dateRange) {
        console.log(`日期范围: ${result.dateRange.start} ~ ${result.dateRange.end}`);
      }
    } else {
      console.error('\n❌ 同步失败:', result.error);
    }
  },

  // 同步涨停池K线
  'sync-limitup-kline': async (date) => {
    if (!date) {
      const today = new Date().toISOString().slice(0, 10);
      date = today;
    }

    console.log(`📈 同步 ${date} 涨停池K线数据...\n`);
    const result = await marketSync.syncLimitUpStockKline(date, { limit: 100 });

    if (result.success) {
      console.log('\n✅ 同步成功！');
      console.log(`总数: ${result.total} 只`);
      console.log(`成功: ${result.successCount} 只`);
      console.log(`总记录: ${result.totalRecords} 条`);
    } else {
      console.error('\n❌ 同步失败:', result.error);
    }
  },

  // 同步竞价数据
  'sync-auction': async () => {
    console.log('⏰ 同步竞价数据...\n');
    const result = await marketSync.syncAuctionData();

    if (result.success) {
      console.log('\n✅ 同步成功！');
      console.log(`日期: ${result.date}`);
      console.log(`数据量: ${result.count} 只`);
    } else {
      console.error('\n❌ 同步失败:', result.error || result.message);
    }
  },

  // 每日任务
  'daily-task': async () => {
    console.log('🔄 执行每日同步任务...\n');
    await scheduler.dailySyncTask();
  },

  // 竞价任务
  'auction-task': async () => {
    console.log('⏰ 执行竞价同步任务...\n');
    await scheduler.auctionSyncTask();
  },

  // 维护任务
  'maintenance': async () => {
    console.log('🔧 执行数据库维护...\n');
    await scheduler.maintenanceTask();
  },

  // 查看状态
  'status': async () => {
    console.log('📊 数据同步状态\n');

    const status = scheduler.getSyncStatus();

    console.log('数据库统计:');
    console.log(`  股票数量: ${status.database.stockCount}`);
    console.log(`  交易日数量: ${status.database.tradingDates.length}`);
    if (status.database.tradingDates.length > 0) {
      console.log(`  最新交易日: ${status.database.tradingDates[0]}`);
    }

    console.log('\n最后同步时间:');
    for (const [type, date] of Object.entries(status.lastSync)) {
      if (date) {
        console.log(`  ${type}: ${date}`);
      }
    }
  },

  // 帮助信息
  'help': () => {
    console.log(`
📊 市场数据同步工具

使用方法:
  node sync-data.js [命令] [参数]

命令列表:

  sync-today                    同步今日市场数据
  sync-date <日期>              同步指定日期数据
                                示例: sync-date 2026-04-26

  sync-recent [天数]            同步最近N天数据（默认7天）
                                示例: sync-recent 30

  sync-kline <代码> [数量]      同步个股K线数据
                                示例: sync-kline 000001 100

  sync-limitup-kline [日期]     同步涨停池股票K线
                                示例: sync-limitup-kline 2026-04-26

  sync-auction                  同步竞价数据（9:15-9:25）

  daily-task                    执行每日同步任务（收盘后）
  auction-task                  执行竞价同步任务
  maintenance                   执行数据库维护

  status                        查看同步状态
  help                          显示帮助信息

示例:
  node sync-data.js sync-today
  node sync-data.js sync-recent 30
  node sync-data.js sync-kline 000001 100
  node sync-data.js status
`);
  }
};

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const params = args.slice(1);

  if (!commands[command]) {
    console.error(`❌ 未知命令: ${command}`);
    console.log('使用 "node sync-data.js help" 查看帮助');
    process.exit(1);
  }

  try {
    await commands[command](...params);
  } catch (error) {
    console.error('\n❌ 执行失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 执行
main();
