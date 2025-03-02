/*
1 8 * * * llb.js
 */
// 打开app抓去m-center-prod-linli.timesgroup.cn的 memberId和authorization填到变量llb_cookie就行 authorization要去掉前面的brerar id和token用｜隔开 
// 支持多用户运行
// 多用户用&或者@隔开
// 例如账号1：10086 账号2： 1008611
// 则变量为10086&1008611

var https = require('https');

// 从青龙面板的环境变量获取用户信息
let users = [];
if (process.env.llb_cookie) {
    let userEntries = process.env.llb_cookie.split('&');
    
    users = userEntries.map(entry => {
        let [id, token] = entry.split('|');
        if (id && token) {
            return {
                id: id.trim(),
                token: Bearer ${token.trim()}
            };
        }
    }).filter(Boolean);
} else {
    console.error("未在环境变量中找到 llb_cookie");
    process.exit(1);
}

// 执行签到
function signIn() {
    const date = new Date();
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const t = ${y}-${m}-${d} 07:56:19;

    console.log("当前时间:", t);

    users.forEach((item) => {
        let postData = JSON.stringify({
            "behaviourId": 10,
            "clientCode": "sys_linlibang",
            "createTime": t,
            "mapPamater": { "sign": t },
            "memberId": item.id
        });

        let options = {
            hostname: 'm-center-prod-linli.timesgroup.cn',
            path: '/times/member-bff/user-behaviour/api-c/v1/user-behaviour/collect',  // 修正路径
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                "locale": "zh_CN",
                "authorization": item.token,
                'Content-Length': Buffer.byteLength(postData)
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => { console.log(${item.id} 调用情况: , data); });
        });

        req.write(postData);
        req.end();
        req.on('error', (e) => { console.error(调用失败: ${e.message}); });
    });
}

// 直接执行一次，青龙会自动按照 @cron 规则定时执行
signIn();
