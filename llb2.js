var https = require('https')
var fs = require('fs') 

let user=[
  {
    id:'4344943535456256038',
    token:'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX25hbWUiOiJvbDdpZ2pvSU85RlBMQ2RxV3lRdUtVN19PQzV3Iiwic2NvcGUiOlsiYWxsIl0sImlkIjoyMjcwNDgwNzczOTM5MjA1ODcwLCJleHAiOjE3NDA5MzE2NTMsImF1dGhvcml0aWVzIjpbInZpc2l0b3IiLCJvd25lciJdLCJqdGkiOiIzMjVjYTg0NS03MWRjLTRmMmYtYTlkOS1lNTk1MjkxNWQ1OWEiLCJjbGllbnRfaWQiOiJhcHBfYyJ9.Df_KFt6iU4nDYsvYL6s1BrPNNfR-vnCJichrXKK-waz3c8Ocxi-ePIUMqY682gTDX5s5ot6E9jn1GyaC5iHz1YENnRSnf7JQgotFBzNV5r2wK-xqJDI3ShqCsqicCEnCdbnzpv44UHgN6IftkZEis5xpCriFafr9JXTr_-T_4LZ_dIe5d-p38VrSdi4uvQH3_BD52y0NIgLLUWaYD3aFEn4fQAYwE2dUdQaGm1WWa2fPNu6KzlXkGmvjFPZIf9-wil4TF5BpVGsccariBUh3n6Bh9lpY8nNTk3pljQ0gSi6vCINWFswMU_iC8ZJpBz9gihO3tswRqRItkzB_jTid3A'
  }
]

let everyDaySend = function(){
  const date = new Date();
  const y = date.getFullYear(); // 获取当前年份，例如：2021
  const m = date.getMonth() + 1; // 获取当前月份，注意需要加1，例如：9
  const d = date.getDate();
  const t = `${y}-${m}-${d} 07:56:19`
  
  console.log(t)

  user.forEach((item)=>{
    let postData = JSON.stringify({
      "behaviourId": 10,
      "clientCode": "sys_linlibang",
      "createTime": t,
      "mapPamater": {
          "sign": t
      },
      "memberId": item.id
  })
    let options = {
      hostname: 'm-center-prod-linli.timesgroup.cn',
      path:'/times/member-bff/user-behaviour//api-c/v1/user-behaviour/collect',
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "locale": "zh_CN",
        "authorization": `${item.token}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      
    }
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
     
      // 数据接收完毕
      res.on('end', () => {
        console.log(`${item.id}调用情况： `, data);
      });
    });
    req.write(postData);
    req.end();
    req.on('error', (e) => {
      console.error(`调用失败: ${e.message}`);
    });

  })

  setTimeout(()=>{
    everyDaySend()
  },1000*60*60*24)
}

everyDaySend()
