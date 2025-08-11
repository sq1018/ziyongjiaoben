const puppeteer = require('puppeteer-core');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 优化超时设置，适配3个商品查询
const MAX_RETRIES = 0; // 取消重试以节省时间
const NAVIGATION_TIMEOUT = 15000; // 页面加载超时缩短至8秒
const RETRY_DELAY = 500; // 重试延迟（当前重试已启用）
const SCROLL_DELAY = 300; // 滚动延迟缩短至300ms
const ITEM_DELAY = 300 + Math.random() * 200; // 商品间隔缩短至0.3-0.5s
const GLOBAL_TIMEOUT = 55 * 1000; // 全局超时延长至55秒（确保1分钟内完成）
const MAX_ITEMS_PER_RUN = 2; // 单次最大处理商品数

// 环境变量配置
const SKU_IDS = process.env.JD_SKU_IDS ? process.env.JD_SKU_IDS.split('&') : [];
const WECOM_KEY = process.env.JD_WECOM_KEY;
const MONITOR_KEYWORD_REGEX = /配\s*送\s*至/;

// 带时间戳的日志输出
function logWithTime(message) {
    console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

// 获取浏览器路径
async function getBrowserPath() {
    try {
        const paths = [
            'google-chrome-stable', 'google-chrome', 'chromium-browser', 
            'chromium', '/usr/bin/google-chrome', '/usr/local/bin/chrome'
        ];
        
        for (const browserPath of paths) {
            try {
                execSync(`which ${browserPath}`, { stdio: 'ignore' });
                const fullPath = execSync(`which ${browserPath}`, { encoding: 'utf-8' }).trim();
                logWithTime(`✅ 找到系统浏览器: ${fullPath}`);
                return fullPath;
            } catch (e) {
                continue;
            }
        }
    } catch (e) {
        logWithTime('⚠ 未找到系统安装的浏览器');
    }
    
    try {
        const puppeteerFull = require('puppeteer');
        const browserPath = await puppeteerFull.executablePath();
        if (fs.existsSync(browserPath)) {
            logWithTime(`✅ 使用puppeteer自带浏览器: ${browserPath}`);
            return browserPath;
        }
    } catch (e) {
        logWithTime('⚠ 未安装puppeteer，无法使用自带浏览器');
    }
    
    logWithTime('❌ 未找到任何可用浏览器');
    logWithTime('请安装Chrome/Chromium或运行: npm install puppeteer');
    process.exit(1);
}

// 带重试的导航
async function navigateWithRetry(page, url) {
    let retries = MAX_RETRIES;
    while (retries >= 0) {
        try {
            logWithTime(`正在加载页面: ${url} (剩余重试: ${retries})`);
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: NAVIGATION_TIMEOUT
            });
            return true;
        } catch (e) {
            retries--;
            if (retries < 0) {
                logWithTime(`页面加载失败: ${e.message}`);
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
    }
    return false;
}

// 清理文本
function cleanText(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/\s+/g, ' ').trim();
}

// 库存信息获取逻辑
async function getStockInfo(page, skuId) {
    const url = `https://item.jd.com/${skuId}.html`;
    try {
        const loaded = await navigateWithRetry(page, url);
        if (!loaded) {
            return { skuId, error: '页面加载失败' };
        }

        // 页面滚动
        await page.evaluate(() => window.scrollTo(0, 600));
        await new Promise(resolve => setTimeout(resolve, SCROLL_DELAY));

        // 获取商品名称
        let productName = `商品 ${skuId}`;
        try {
            productName = await page.title().then(title => 
                title.length > 5 ? title.replace(/- 京东/, '').trim() : productName
            ).catch(() => productName);
        } catch (e) { /* 忽略错误 */ }

        // 配送信息获取
        let deliveryInfo = '';
        let hasDeliveryKeyword = false;
        try {
            const deliverySelectors = [
                '.delivery-info', '.area-stock', '[class*="delivery"]',
                '.ui-area-text', '.address-choose'
            ];
            
            for (const selector of deliverySelectors) {
                try {
                    const rawText = await page.$eval(selector, el => el.textContent);
                    const cleanedText = cleanText(rawText);
                    
                    if (MONITOR_KEYWORD_REGEX.test(cleanedText)) {
                        hasDeliveryKeyword = true;
                        deliveryInfo = cleanedText;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }
            
            if (!hasDeliveryKeyword) {
                const pageText = await page.evaluate(() => document.body.innerText);
                const cleanedPageText = cleanText(pageText);
                
                if (MONITOR_KEYWORD_REGEX.test(cleanedPageText)) {
                    hasDeliveryKeyword = true;
                    const match = cleanedPageText.match(MONITOR_KEYWORD_REGEX);
                    if (match && match.index !== undefined) {
                        deliveryInfo = cleanedPageText.substring(
                            Math.max(0, match.index - 50), 
                            Math.min(cleanedPageText.length, match.index + 150)
                        ).trim();
                    }
                }
            }
        } catch (e) {
            logWithTime(`[${skuId}] 获取配送信息失败: ${e.message}`);
        }

        // 库存文本
        let stockText = '';
        try {
            stockText = await page.$eval(
                '.summary-stock, .store-txt, .stock', 
                el => el.textContent
            ).then(text => cleanText(text)).catch(() => '');
        } catch (e) { /* 忽略错误 */ }

        // 状态判断
        let status = 'out_of_stock';
        let statusDesc = '无货';
        
        if (hasDeliveryKeyword) {
            status = 'in_stock';
            statusDesc = `有货 (${deliveryInfo.substring(0, 50)}...)`;
        } else if (stockText.includes('补货中') || stockText.includes('预售')) {
            status = 'restocking';
            statusDesc = `补货中 - ${stockText}`;
        } else {
            statusDesc = '无货';
            if (stockText) statusDesc += ` - ${stockText}`;
        }

        return {
            skuId, productName, url, hasDeliveryKeyword,
            deliveryInfo: deliveryInfo.substring(0, 200),
            status, statusDesc, error: null
        };
    } catch (error) {
        return {
            skuId, productName: `商品 ${skuId}`, url,
            hasDeliveryKeyword: false, deliveryInfo: '',
            status: 'error', statusDesc: '查询出错',
            error: error.message
        };
    }
}

// 消息推送
async function sendWecomMsg(result) {
    if (!WECOM_KEY) return false;
    
    const message = `@所有人
📦 【京东商品有货通知】
⏰ 通知时间: ${new Date().toLocaleString()}
----------------------
 🎯 商品名称: ${result.productName}
📊 库存状态: ${result.statusDesc}
----------------------
🔗 抢购链接: ${result.url}`.trim();
    
    try {
        await axios.post(
            `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WECOM_KEY}`,
            { 
                msgtype: "text", 
                text: { 
                    content: message,
                    mentioned_list: ["@all"]
                } 
            },
            { timeout: 5000 }
        );
        logWithTime("✅ 通知已发送（含@所有人）");
        return true;
    } catch (e) {
        logWithTime(`❌ 通知发送失败: ${e.message}`);
        return false;
    }
}

// 主函数
async function main() {
    logWithTime("===== 开始执行监控任务 =====");
    
    if (SKU_IDS.length === 0) {
        logWithTime("❌ 请设置 JD_SKU_IDS 环境变量（格式：sku1&sku2&sku3）");
        return;
    }

    logWithTime(`📋 共${SKU_IDS.length}个商品待查询，本次最多处理${MAX_ITEMS_PER_RUN}个`);
    let browser;
    let success = false;

    try {
        const browserPath = await getBrowserPath();
        
        // 浏览器轻量化配置
        browser = await puppeteer.launch({
            executablePath: browserPath,
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--blink-settings=imagesEnabled=false',
                '--no-zygote',
                '--single-process',
                '--window-size=800,600'
            ],
            defaultViewport: { width: 800, height: 600 },
            timeout: 15000,
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/116.0.0.0 Safari/537.36');
        
        // 强化请求拦截，加速页面加载
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            const url = req.url();
            
            // 拦截广告、追踪和非必要资源
            if (
                url.includes('ad.') || 
                url.includes('track.') || 
                url.includes('analytics.') ||
                type === 'image' || 
                type === 'stylesheet' || 
                type === 'font' || 
                type === 'media'
            ) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // 处理商品查询
        for (const [index, skuId] of SKU_IDS.entries()) {
            // 控制最大处理数量
            if (index >= MAX_ITEMS_PER_RUN) {
                logWithTime(`⚠ 已达单次最大处理数量(${MAX_ITEMS_PER_RUN}个)，剩余商品将在下一轮查询`);
                break;
            }

            logWithTime(`\n${index + 1}/${SKU_IDS.length} 🔍 查询商品: ${skuId}`);
            const result = await getStockInfo(page, skuId);

            const icon = result.status === 'in_stock' ? '🟢' : result.status === 'restocking' ? '🟡' : '🔴';
            logWithTime(`${icon} ${result.productName} => ${result.statusDesc}`);
            logWithTime(`   包含"配送至": ${result.hasDeliveryKeyword ? '是' : '否'}`);

            if (result.status === 'in_stock') {
                await sendWecomMsg(result);
            }

            // 超时检查，提前5秒退出
            if (Date.now() - startTime > GLOBAL_TIMEOUT - 5000) {
                logWithTime("⚠ 即将超时，剩余商品将在下一轮查询");
                break;
            }

            if (index < SKU_IDS.length - 1 && index < MAX_ITEMS_PER_RUN - 1) {
                await new Promise(resolve => setTimeout(resolve, ITEM_DELAY));
            }
        }

        success = true;

    } catch (error) {
        logWithTime(`❌ 程序出错: ${error.message}`);
        console.error(error.stack);
    } finally {
        // 确保浏览器关闭
        if (browser) {
            try {
                await browser.close();
                logWithTime("✅ 浏览器已关闭");
            } catch (e) {
                logWithTime(`⚠ 关闭浏览器失败: ${e.message}`);
            }
        }
        logWithTime(`===== 监控任务结束（${success ? '成功' : '失败'}）=====\n`);
    }
}

// 全局超时控制
const startTime = Date.now();
const mainTimeout = setTimeout(() => {
    logWithTime("\n❌ 任务超时强制终止");
    process.exit(1);
}, GLOBAL_TIMEOUT);

main().then(() => {
    clearTimeout(mainTimeout);
    process.exit(0);
}).catch(err => {
    logWithTime(`❌ 未捕获异常: ${err.message}`);
    clearTimeout(mainTimeout);
    process.exit(1);
});
