const { chromium } = require('playwright');
const axios = require('axios');
const userAgents = require('user-agents');

// 优化配置
const MAX_RETRIES = 2;
const NAVIGATION_TIMEOUT = 30000;
const MIN_ITEM_DELAY = 500;  // 0.5秒
const MAX_ITEM_DELAY = 2000; // 2秒
const GLOBAL_TIMEOUT = 120 * 1000;
const MAX_ITEMS_PER_RUN = 2;
const WAIT_FOR_KEY_ELEMENTS = 15000;
const HUMAN_LIKE_DELAY_MULTIPLIER = 1.5;
const ITEM_TIMEOUT = 40000;
const MAX_CAPTCHA_RETRY = 3;
const PROXY_POOL = process.env.PROXY_POOL ? process.env.PROXY_POOL.split(',') : [];

// 环境变量配置
const SKU_IDS = process.env.JD_SKU_IDS ? process.env.JD_SKU_IDS.split('&') : [];
const WECOM_KEY = process.env.JD_WECOM_KEY;
const PRIMARY_PROXY = process.env.PRIMARY_PROXY;
const USE_RANDOM_UA = process.env.USE_RANDOM_UA === 'true';
const USE_MOBILE_UA = process.env.USE_MOBILE_UA === 'true';

// 带时间戳的日志输出
function logWithTime(message) {
    console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

// 生成随机延迟
function getRandomDelay(min, max) {
    return min + Math.random() * (max - min);
}

// 清理文本
function cleanText(text) {
    return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

// 检查是否为验证码页面
async function isCaptchaPage(page) {
    try {
        const quickCheckSelectors = [
            '#captcha', '.captcha-container', '.verify-wrap',
            '.JDJRV-wrap', '.JDJRV-suspend', '.captcha_verify_container',
            '.nc_iconfont', '.geetest_holder', '.verify-bar'
        ];
        
        for (const selector of quickCheckSelectors) {
            if (await page.$(selector)) {
                return true;
            }
        }
        
        const bodyText = await page.evaluate(() => document.body.textContent);
        const cleanedText = cleanText(bodyText);
        
        const captchaKeywords = [
            '验证一下', '安全验证', '点我反馈', '拖动滑块', 
            '验证中心', '拼图验证', '智能验证', '点击完成验证'
        ];
        
        for (const keyword of captchaKeywords) {
            if (cleanedText.includes(keyword)) {
                return true;
            }
        }
        
        return false;
    } catch (e) {
        logWithTime(`验证码检测失败: ${e.message}`);
        return false;
    }
}

// 获取随机代理
function getRandomProxy() {
    if (PROXY_POOL.length > 0) {
        return PROXY_POOL[Math.floor(Math.random() * PROXY_POOL.length)];
    }
    return PRIMARY_PROXY;
}

// 创建新页面（不使用页面级setUserAgent）
async function createNewPage(context) {
    const newPage = await context.newPage();
    // 添加防检测脚本
    await newPage.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { 
            get: () => [{
                description: 'Portable Document Format',
                filename: 'internal-pdf-viewer',
                name: 'PDF Viewer'
            }] 
        });
    });
    return newPage;
}

// 创建新上下文（在上下文级别设置用户代理）
async function createNewContext(browser, userAgent, proxy) {
    const contextOptions = {
        userAgent,
        viewport: USE_MOBILE_UA ? { width: 375, height: 812 } : { width: 1366, height: 768 },
        locale: 'zh-CN',
        deviceScaleFactor: 1,
        isMobile: !!USE_MOBILE_UA,
        hasTouch: !!USE_MOBILE_UA,
        timezoneId: 'Asia/Shanghai'
    };
    
    // 如果有代理，添加代理配置
    if (proxy) {
        contextOptions.proxy = {
            server: proxy,
            username: process.env.PROXY_USER,
            password: process.env.PROXY_PASSWORD
        };
    }
    
    return browser.newContext(contextOptions);
}

// 尝试绕过验证码 - 完全移除页面级setUserAgent
async function bypassCaptcha(browser, currentContext, currentPage, skuId, originalUserAgent) {
    logWithTime("尝试高级验证码绕过策略...");
    
    try {
        // 关闭当前页面和上下文
        await currentPage.close();
        await currentContext.close();
        
        // 策略1: 使用新用户代理创建新上下文（在上下文级别设置）
        const newUserAgent = new userAgents({ deviceCategory: 'desktop' }).toString();
        logWithTime(`切换用户代理: ${newUserAgent.substring(0, 50)}...`);
        
        const newContext = await createNewContext(browser, newUserAgent);
        const newPage = await createNewPage(newContext);
        
        // 导航到商品页面
        await newPage.goto(`https://item.jd.com/${skuId}.html`, { 
            waitUntil: 'domcontentloaded',
            timeout: NAVIGATION_TIMEOUT,
            referer: 'https://www.jd.com/'
        });
        await newPage.waitForTimeout(3000);
        
        // 检查是否绕过成功
        if (!await isCaptchaPage(newPage)) {
            logWithTime("✅ 用户代理切换成功绕过验证码");
            return { success: true, page: newPage, context: newContext };
        }
        
        // 策略2: 切换代理IP (如果配置了代理池)
        if (PROXY_POOL.length > 0) {
            const newProxy = getRandomProxy();
            logWithTime(`切换代理IP: ${newProxy}`);
            
            // 关闭当前新页面和上下文
            await newPage.close();
            await newContext.close();
            
            // 创建带新代理的新上下文
            const proxyContext = await createNewContext(browser, newUserAgent, newProxy);
            const proxyPage = await createNewPage(proxyContext);
            
            // 导航到商品页面
            await proxyPage.goto(`https://item.jd.com/${skuId}.html`, { 
                waitUntil: 'domcontentloaded',
                timeout: NAVIGATION_TIMEOUT,
                referer: 'https://www.jd.com/'
            });
            await proxyPage.waitForTimeout(3000);
            
            // 检查是否绕过成功
            if (!await isCaptchaPage(proxyPage)) {
                logWithTime("✅ 代理IP切换成功绕过验证码");
                return { success: true, page: proxyPage, context: proxyContext };
            }
            
            // 仍然有验证码，关闭代理页面和上下文
            await proxyPage.close();
            await proxyContext.close();
        }
        
        // 所有策略都失败，使用原始用户代理创建新上下文
        const fallbackContext = await createNewContext(browser, originalUserAgent);
        const fallbackPage = await createNewPage(fallbackContext);
        return { success: false, page: fallbackPage, context: fallbackContext };
        
    } catch (e) {
        logWithTime(`绕过验证码失败: ${e.message}`);
        // 异常情况下创建新上下文和页面
        const fallbackContext = await createNewContext(browser, originalUserAgent);
        const fallbackPage = await createNewPage(fallbackContext);
        return { success: false, page: fallbackPage, context: fallbackContext };
    }
}

// 库存信息获取逻辑
async function getStockInfo(browser, context, initialPage, skuId, userAgent) {
    const url = `https://item.jd.com/${skuId}.html`;
    const result = {
        skuId, 
        productName: `商品 ${skuId}`,
        url,
        status: 'error',
        statusDesc: '查询出错',
        error: null
    };

    let retries = MAX_RETRIES;
    const itemStartTime = Date.now();
    let captchaRetryCount = 0;
    let currentPage = initialPage;
    let currentContext = context;

    while (retries >= 0) {
        try {
            if (Date.now() - itemStartTime > ITEM_TIMEOUT) {
                throw new Error(`商品查询超时 (${ITEM_TIMEOUT}ms)`);
            }
            
            logWithTime(`正在加载页面: ${url} (剩余重试: ${retries})`);
            
            await currentPage.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: NAVIGATION_TIMEOUT,
                referer: 'https://www.jd.com/'
            });

            if (await isCaptchaPage(currentPage)) {
                logWithTime("⚠ 检测到验证码页面");
                
                if (captchaRetryCount < MAX_CAPTCHA_RETRY) {
                    captchaRetryCount++;
                    const bypassResult = await bypassCaptcha(browser, currentContext, currentPage, skuId, userAgent);
                    
                    currentPage = bypassResult.page;
                    currentContext = bypassResult.context;
                    
                    if (bypassResult.success) {
                        logWithTime(`✅ 验证码绕过成功 (尝试次数: ${captchaRetryCount})`);
                        continue;
                    }
                }
                
                throw new Error("验证码页面");
            }

            captchaRetryCount = 0;
            
            try {
                await currentPage.waitForSelector('.sku-name, #InitCartUrl, .btn-addtocart, .summary', {
                    timeout: WAIT_FOR_KEY_ELEMENTS,
                    state: 'attached'
                });
            } catch (e) {
                logWithTime("⚠ 关键元素加载超时，尝试继续...");
            }

            try {
                const nameElement = await currentPage.$('.sku-name');
                if (nameElement) {
                    result.productName = await nameElement.evaluate(el => {
                        return Array.from(el.childNodes)
                            .filter(node => node.nodeType === Node.TEXT_NODE)
                            .map(node => node.textContent)
                            .join(' ')
                            .trim();
                    });
                }
                
                if (!result.productName || result.productName.length < 3) {
                    const title = await currentPage.title();
                    if (title && title.length > 5) {
                        result.productName = title.replace(/- 京东/, '').trim();
                    }
                }
            } catch (e) {
                logWithTime(`获取商品名称失败: ${e.message}`);
            }

            const stockStatus = await detectStockStatus(currentPage, skuId);
            
            result.status = stockStatus;
            if (stockStatus === 'in_stock') {
                result.statusDesc = '有货';
            } else if (stockStatus === 'out_of_stock') {
                result.statusDesc = '无货';
            } else if (stockStatus === 'restocking') {
                result.statusDesc = '补货中';
            } else if (stockStatus === 'captcha') {
                result.statusDesc = '需要验证码';
            } else if (stockStatus === 'unknown') {
                result.statusDesc = '库存状态未知';
            }

            result.error = null;
            return { ...result, page: currentPage, context: currentContext };

        } catch (error) {
            if (error.message.includes('超时')) {
                result.error = error.message;
                logWithTime(`❌ ${error.message}`);
                return { ...result, page: currentPage, context: currentContext };
            }
            
            if (error.message.includes("验证码")) {
                result.status = 'captcha';
                result.statusDesc = '需要验证码';
                result.error = "验证码页面";
                return { ...result, page: currentPage, context: currentContext };
            }
            
            if (retries <= 0) {
                result.error = error.message;
                return { ...result, page: currentPage, context: currentContext };
            }
            
            retries--;
            logWithTime(`页面加载失败: ${error.message}，剩余重试: ${retries}`);
            
            const delayMultiplier = error.message.includes("验证码") ? HUMAN_LIKE_DELAY_MULTIPLIER : 1;
            const delayTime = delayMultiplier * getRandomDelay(5000, 10000);
            logWithTime(`⏳ 重试延迟: ${Math.round(delayTime/1000)}秒`);
            await currentPage.waitForTimeout(delayTime);
        }
    }
}

// 库存检测方法
async function detectStockStatus(page, skuId) {
    try {
        logWithTime("开始检测库存状态...");
        
        if (await isCaptchaPage(page)) {
            logWithTime("检测到验证码页面");
            return 'captcha';
        }
        
        if (await page.$('.product-off, .off-shelf, .error-404')) {
            logWithTime("商品已下架或不存在");
            return 'out_of_stock';
        }
        
        const buyButtonSelectors = [
            '#InitCartUrl', '.btn-addtocart', '.btn-special1',
            '.btn-buy', '.btn-cart', '.J-addcart'
        ];
        
        for (const selector of buyButtonSelectors) {
            try {
                const buyButton = await page.$(selector);
                if (!buyButton) continue;
                
                const isVisible = await buyButton.isVisible();
                if (!isVisible) continue;
                
                const buttonText = cleanText(await buyButton.textContent());
                if (!buttonText) continue;
                
                if (buttonText.includes('加入购物车') || buttonText.includes('立即购买') || buttonText.includes('抢购')) {
                    const isDisabled = await buyButton.evaluate(btn => 
                        btn.disabled || btn.classList.contains('disabled')
                    );
                    if (!isDisabled) {
                        logWithTime(`✅ 购买按钮文本: "${buttonText}" - 有货`);
                        return 'in_stock';
                    }
                }
                
                if (buttonText.includes('无货') || buttonText.includes('已售罄') || buttonText.includes('缺货')) {
                    logWithTime(`❌ 购买按钮文本: "${buttonText}" - 无货`);
                    return 'out_of_stock';
                }
                
                if (buttonText.includes('预售') || buttonText.includes('补货中') || buttonText.includes('到货通知')) {
                    logWithTime(`⏳ 购买按钮文本: "${buttonText}" - 补货中`);
                    return 'restocking';
                }
            } catch (e) {
                logWithTime(`购买按钮检测异常: ${e.message}`);
            }
        }
        
        const stockTextSelectors = [
            '.summary-stock', '.stock', '.stock-state', 
            '.store-txt', '.inventory', '.product-status',
            '.sku-stock', '.availability'
        ];
        
        for (const selector of stockTextSelectors) {
            try {
                const stockElement = await page.$(selector);
                if (!stockElement) continue;
                
                const stockText = cleanText(await stockElement.textContent());
                if (!stockText) continue;
                
                if (stockText.includes('有货') || stockText.includes('现货') || 
                    stockText.includes('库存充足') || stockText.includes('可配送')) {
                    logWithTime(`✅ 库存文本: "${stockText}" - 有货`);
                    return 'in_stock';
                }
                
                if (stockText.includes('无货') || stockText.includes('缺货') || 
                    stockText.includes('售罄') || stockText.includes('无库存')) {
                    logWithTime(`❌ 库存文本: "${stockText}" - 无货`);
                    return 'out_of_stock';
                }
                
                if (stockText.includes('补货中') || stockText.includes('预售') || 
                    stockText.includes('即将到货')) {
                    logWithTime(`⏳ 库存文本: "${stockText}" - 补货中`);
                    return 'restocking';
                }
            } catch (e) {
                logWithTime(`库存文本检测异常: ${e.message}`);
            }
        }
        
        try {
            const stockData = await page.evaluate(() => {
                const productVars = ['product', 'skuProduct', 'wareInfo', 'itemData', 'productInfo'];
                for (const varName of productVars) {
                    const data = window[varName];
                    if (data && data.stock) {
                        return {
                            stock: data.stock,
                            status: data.stockStatus || data.status
                        };
                    }
                }
                return null;
            });
            
            if (stockData) {
                if (stockData.stock > 0 || stockData.status === 'INSTOCK') {
                    logWithTime(`✅ 隐藏数据: 库存=${stockData.stock} - 有货`);
                    return 'in_stock';
                }
                if (stockData.stock === 0 || stockData.status === 'OUTOFSTOCK') {
                    logWithTime(`❌ 隐藏数据: 库存=${stockData.stock} - 无货`);
                    return 'out_of_stock';
                }
            }
        } catch (e) {
            logWithTime(`隐藏库存数据检测异常: ${e.message}`);
        }
        
        try {
            const notifyButton = await page.$('.btn-notify, .arrival-notify, .notify-btn');
            if (notifyButton && await notifyButton.isVisible()) {
                logWithTime(`⏳ 检测到到货通知按钮 - 补货中`);
                return 'restocking';
            }
        } catch (e) {
            logWithTime(`到货通知按钮检测异常: ${e.message}`);
        }
        
        try {
            const priceElement = await page.$('.p-price, .price, .sku-price');
            if (!priceElement || !(await priceElement.isVisible())) {
                logWithTime(`❌ 价格区域不可见 - 无货`);
                return 'out_of_stock';
            }
        } catch (e) {
            logWithTime(`价格区域检测异常: ${e.message}`);
        }
        
        logWithTime("无法确定库存状态");
        return 'unknown';
        
    } catch (error) {
        logWithTime(`库存检测失败: ${error.message}`);
        return 'error';
    }
}

// 消息推送（仅在有货时发送）
async function sendWecomMsg(result) {
    if (!WECOM_KEY) {
        logWithTime("⚠ 未配置企业微信机器人KEY");
        return false;
    }
    
    if (result.status !== 'in_stock') {
        return false;
    }
    
    const timestamp = new Date().toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const message = `@所有人
📦 【京东商品有货通知】
⏰ 通知时间: ${timestamp}
----------------------
 🎯 商品名称: ${result.productName}
📊 库存状态: ${result.statusDesc}
----------------------
🔗 抢购链接: ${result.url}`;
    
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
        logWithTime("✅ 有货通知已发送");
        return true;
    } catch (e) {
        logWithTime(`❌ 通知发送失败: ${e.message}`);
        return false;
    }
}

// 访问京东首页建立cookies
async function warmupJdHomepage(page, maxRetries = 2) {
    let retries = 0;
    
    while (retries <= maxRetries) {
        try {
            logWithTime(`访问京东首页建立cookies... (尝试 ${retries + 1}/${maxRetries + 1})`);
            
            await page.goto('https://www.jd.com', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            
            const title = await page.title();
            if (title.includes('京东') || title.includes('JD.com')) {
                logWithTime("✅ 京东首页加载成功");
                await page.waitForTimeout(2000);
                return true;
            }
            
            throw new Error("京东首页加载失败，标题不匹配");
        } catch (error) {
            logWithTime(`京东首页加载失败: ${error.message}`);
            
            if (retries >= maxRetries) {
                logWithTime("⚠ 京东首页加载失败，跳过预热步骤");
                return false;
            }
            
            retries++;
            const delay = getRandomDelay(5000, 10000);
            logWithTime(`⏳ 重试京东首页延迟: ${Math.round(delay/1000)}秒`);
            await page.waitForTimeout(delay);
        }
    }
    
    return false;
}

// 主函数
async function main() {
    logWithTime("===== 开始执行京东库存监控 =====");
    
    if (SKU_IDS.length === 0) {
        logWithTime("❌ 请设置环境变量 JD_SKU_IDS（格式：sku1&sku2&sku3）");
        return;
    }

    logWithTime(`📋 共 ${SKU_IDS.length} 个商品待查询`);
    let browser;
    const startTime = Date.now();
    
    // 全局超时处理
    const globalTimeout = setTimeout(() => {
        logWithTime("\n❌ 任务超时强制终止");
        process.exit(1);
    }, GLOBAL_TIMEOUT);

    try {
        // 浏览器配置
        const browserOptions = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-extensions',
                '--blink-settings=imagesEnabled=true',
                '--window-size=1366,768',
                '--lang=zh-CN',
                '--disable-gpu'
            ]
        };
        
        browser = await chromium.launch(browserOptions);
        
        // 用户代理选择（只在上下文级别设置）
        let userAgent;
        if (USE_MOBILE_UA) {
            userAgent = new userAgents({ deviceCategory: 'mobile' }).toString();
            logWithTime("使用移动端用户代理");
        } else if (USE_RANDOM_UA) {
            userAgent = new userAgents({ deviceCategory: 'desktop' }).toString();
            logWithTime("使用随机桌面端用户代理");
        } else {
            userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';
        }
        
        // 初始上下文（在上下文级别设置用户代理）
        let context = await createNewContext(browser, userAgent, getRandomProxy() || PRIMARY_PROXY);

        // 减少资源拦截
        await context.route('**/*', route => {
            const url = route.request().url();
            
            const blockPatterns = [
                /ad\.doubleclick\.net/, /google-analytics\.com/, 
                /scorecardresearch\.com/, /ads\.jd\.com/,
                /log\.jd\.com/, /stat\.jd\.com/
            ];
            
            if (blockPatterns.some(pattern => pattern.test(url))) {
                route.abort();
            } else {
                route.continue();
            }
        });

        let page = await createNewPage(context);
        
        // 设置请求头
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache'
        });
        
        // 添加随机延迟
        await page.waitForTimeout(getRandomDelay(2000, 5000));
        
        // 访问京东首页建立cookies
        await warmupJdHomepage(page);
        
        // 处理商品查询
        let captchaCount = 0;
        const maxItems = Math.min(SKU_IDS.length, MAX_ITEMS_PER_RUN);
        for (let i = 0; i < maxItems; i++) {
            if (Date.now() - startTime > GLOBAL_TIMEOUT - 30000) {
                logWithTime("⚠ 即将超时，终止后续查询");
                break;
            }
            
            const skuId = SKU_IDS[i];
            logWithTime(`\n${i + 1}/${maxItems} 🔍 查询商品: ${skuId}`);
            
            const {result, page: newPage, context: newContext} = await (async () => {
                const res = await getStockInfo(browser, context, page, skuId, userAgent);
                return {
                    result: {
                        skuId: res.skuId,
                        productName: res.productName,
                        url: res.url,
                        status: res.status,
                        statusDesc: res.statusDesc,
                        error: res.error
                    },
                    page: res.page,
                    context: res.context
                };
            })();
            
            page = newPage;
            context = newContext || context;
            
            const icon = result.status === 'in_stock' ? '🟢' : 
                         result.status === 'out_of_stock' ? '🔴' : 
                         result.status === 'restocking' ? '🟡' : 
                         result.status === 'captcha' ? '🔐' : 
                         result.status === 'error' ? '❌' : '⚪';
            
            logWithTime(`${icon} ${result.productName}`);
            logWithTime(`库存状态: ${result.statusDesc}`);
            
            if (result.status === 'in_stock') {
                await sendWecomMsg(result);
            }
            
            if (result.status === 'captcha') {
                captchaCount++;
                if (captchaCount >= 2) {
                    logWithTime("⚠ 多次遇到验证码，终止任务");
                    break;
                }
                
                const delayTime = HUMAN_LIKE_DELAY_MULTIPLIER * getRandomDelay(8000, 15000);
                logWithTime(`⚠ 验证码后延迟: ${Math.round(delayTime/1000)}秒`);
                await page.waitForTimeout(delayTime);
            }
            
            if (i < maxItems - 1) {
                const delay = getRandomDelay(MIN_ITEM_DELAY, MAX_ITEM_DELAY);
                logWithTime(`⏳ 商品间延迟: ${Math.round(delay/1000)}秒`);
                await page.waitForTimeout(delay);
            }
        }

        logWithTime("✅ 监控任务完成");

    } catch (error) {
        logWithTime(`❌ 程序出错: ${error.message}`);
    } finally {
        clearTimeout(globalTimeout);
        
        if (browser) {
            try {
                await browser.close();
                logWithTime("✅ 浏览器已关闭");
            } catch (e) {
                logWithTime(`⚠ 关闭浏览器失败: ${e.message}`);
            }
        }
        logWithTime("===== 监控任务结束 =====");
    }
}

// 执行主函数
main();
