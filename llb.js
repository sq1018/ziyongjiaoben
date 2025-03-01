var https = require('https')
var fs = require('fs') 

let user=[
  {
    id:'2446588726726361091',
    token:'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX25hbWUiOiJvbDdpZ2pyQjJoTm1YXzVOb0N6SFJ6RVl0QUkwIiwic2NvcGUiOlsiYWxsIl0sImlkIjoyNDE1OTMyNzEwNDU2MzkzNzU5LCJleHAiOjE3NDA3MTAwMDAsImF1dGhvcml0aWVzIjpbInZpc2l0b3IiLCJvd25lciJdLCJqdGkiOiJiMGI0MDU3YS1jNzNiLTQ4ZWEtYWM0Ny1jNzQxNjFiNmQzMmMiLCJjbGllbnRfaWQiOiJhcHBfYyJ9.F6gvDiar0ONZ-dkgkuswiXYvf5KCYnhjkyKeGqxiJfaRIl0kCz-rrjI1vPJdi_5omCR7WfSMZckzStZubj-va-u4SXODt1-MamHI8UIn8c_YfS9-WG2Ble3dZtaj0QIoTMrLVH7UldXriCCDIchYnb7MTdlCdOELhK0_z66odq6B12sgspeMUGYciyf4lanj9hjmDgy9BGjP3hc5r6xCwmnHrAbN4YWSHTec_Z8gQ3hC_1ARqO3XAzoDD8hYxmlkK2DlLLX4yJqcMHXyxrEYkUGIxKiDoRctz2rbgqzGqMkfi4ptoKw0Ak07MWKqXvIYnrsHU8DCVFvZKa-ac4Ivgg'
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
