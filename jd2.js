const { chromium } = require('playwright');

// 针对慢加载页面的优化配置
const MAX_RETRIES = 2; // 增加重试次数到2次
const BASE_TIMEOUT = 40000; // 基础超时延长到40秒
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36';

// 从环境变量获取商品ID
function getSkuIdsFromEnv() {
    if (process.env.JD_SKU_IDS) {
        const skuIds = process.env.JD_SKU_IDS.split('&').filter(id => id.trim() !== '');
        if (skuIds.length > 0) {
            console.log(`从环境变量获取到 ${skuIds.length} 个商品ID`);
            return skuIds;
        }
    }
    console.log('使用默认测试商品ID');
    return ['7642955', '100086268074', '10076410826108'];
}

async function getSinglePageTitle(page, skuId) {
    const url = `https://item.jd.com/${skuId}.html`;
    let retries = 0;
    let title = null;

    while (retries <= MAX_RETRIES) {
        // 重试时逐步延长超时时间（最多延长50%）
        const currentTimeout = BASE_TIMEOUT + (BASE_TIMEOUT * 0.5 * retries);
        
        try {
            console.log(`访问商品 ${skuId}（第 ${retries + 1} 次，超时: ${currentTimeout/1000}秒）`);
            const start = Date.now();
            
            // 混合等待策略：先等DOM就绪，再短等网络稳定
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: currentTimeout
            });
            
            // 额外等待1秒，给JS留时间生成标题
            await page.waitForTimeout(1000);
            
            // 延长标题轮询到4秒
            let titleCheckCount = 0;
            while (!title && titleCheckCount < 20) { // 20次*200ms=4秒
                title = await page.title().catch(() => null);
                if (title) break;
                await page.waitForTimeout(200);
                titleCheckCount++;
            }
            
            if (!title) throw new Error('未获取到标题');
            
            console.log(`商品 ${skuId} 标题: ${title.substring(0, 50)}...`);
            console.log(`耗时: ${(Date.now() - start) / 1000}秒`);
            
            if (title.includes('验证')) {
                console.log(`商品 ${skuId} 触发验证，重试...`);
                retries++;
                // 验证页面重试前等待更久
                await page.waitForTimeout(2000 + Math.random() * 2000);
                continue;
            }
            
            break;
        } catch (error) {
            retries++;
            console.error(`商品 ${skuId} 尝试 ${retries} 失败: ${error.message}`);
            
            if (retries > MAX_RETRIES) {
                return `商品 ${skuId} 获取失败`;
            }
            
            // 重试间隔随次数增加（指数退避）
            const delay = 1000 * Math.pow(2, retries) + Math.random() * 1000;
            console.log(`等待 ${delay.toFixed(0)}ms 后重试...`);
            await page.waitForTimeout(delay);
        }
    }
    
    return title;
}

async function batchGetTitles() {
    const skuIds = getSkuIdsFromEnv();
    if (skuIds.length === 0) {
        console.error('无商品ID，退出');
        return;
    }

    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-extensions',
                '--blink-settings=imagesEnabled=false'
            ]
        });
        
        const page = await browser.newPage({
            userAgent: USER_AGENT,
            viewport: { width: 1366, height: 768 },
            javaScriptEnabled: true
        });

        // 资源拦截保持适度：允许文档、脚本和XHR（部分标题依赖接口数据）
        await page.route('**/*', route => {
            const type = route.request().resourceType();
            if (['document', 'script', 'xhr', 'fetch'].includes(type)) {
                route.continue();
            } else {
                route.abort();
            }
        });

        const results = [];
        
        for (const [index, skuId] of skuIds.entries()) {
            console.log(`\n处理第 ${index + 1}/${skuIds.length} 个商品`);
            const title = await getSinglePageTitle(page, skuId);
            results.push({
                skuId,
                title,
                timestamp: new Date().toLocaleString()
            });
            
            if (index < skuIds.length - 1) {
                const delay = 1500 + Math.random() * 1500; // 稍延长商品间隔，减少压力
                console.log(`等待 ${delay.toFixed(0)}ms 后处理下一个`);
                await page.waitForTimeout(delay);
            }
        }

        console.log('\n===== 结果汇总 =====');
        results.forEach(item => {
            console.log(`[${item.skuId}] ${item.title.substring(0, 60)}...`);
        });

        return results;

    } catch (error) {
        console.error(`批量处理失败: ${error.message}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        console.log('浏览器已关闭');
    }
}

// 执行
batchGetTitles();
    
