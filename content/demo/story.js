// 示範內容（A 的燼語墓園）：說話者、頭像、對白
// 只放資料，不放引擎邏輯；kit/ 在載入時讀 window.CONTENT。換內容＝另寫一組同樣欄位的檔案（見 kit/CONTENT-API.md）。
'use strict';
window.CONTENT = window.CONTENT || {};
CONTENT.portraits={
  mu:'<rect width="84" height="84" fill="#120f18"/><path d="M14 84 Q18 58 42 56 Q66 58 70 84Z" fill="#3b2350"/><circle cx="42" cy="45" r="15" fill="#c9a98e"/><path d="M16 35 L68 35 L58 30 Q48 6 38 2 Q38 18 26 30Z" fill="#3b2350"/><circle cx="36" cy="46" r="1.9" fill="#2a1a10"/><circle cx="48" cy="46" r="1.9" fill="#2a1a10"/><path d="M38 53 Q42 55 46 53" stroke="#8a5a40" stroke-width="1.5" fill="none"/><circle cx="63" cy="70" r="4" fill="#ff9a4a"/>',
  elder:'<rect width="84" height="84" fill="#14130f"/><path d="M10 84 Q12 44 42 30 Q72 44 74 84Z" fill="#4a4a48"/><circle cx="42" cy="46" r="14" fill="#b89a82"/><path d="M28 50 Q42 82 56 50 Q50 58 42 58 Q34 58 28 50Z" fill="#ddd8cc"/><path d="M33 42 L39 43 M45 43 L51 42" stroke="#2a2018" stroke-width="2"/><path d="M14 52 Q20 22 42 18 Q64 22 70 52 Q60 32 42 30 Q24 32 14 52Z" fill="#5c5b57"/>',
  lord:'<rect width="84" height="84" fill="#0a0710"/><path d="M8 84 Q14 30 42 14 Q70 30 76 84Z" fill="#1b1028"/><path d="M26 30 L30 12 L36 26 L42 8 L48 26 L54 12 L58 30Z" fill="#2c1840"/><ellipse cx="42" cy="46" rx="16" ry="19" fill="#2a1f3a"/><ellipse cx="35" cy="44" rx="4" ry="6" fill="#c9a6ff"/><ellipse cx="49" cy="44" rx="4" ry="6" fill="#c9a6ff"/><path d="M34 58 Q42 52 50 58" stroke="#c9a6ff" stroke-width="1.5" fill="none"/>'};
CONTENT.speakers={mu:{n:'沐炎',c:'#ffb27a',pitch:1.25,rate:1.05},elder:{n:'灰翁',c:'#d9d2c3',pitch:.7,rate:.92},lord:{n:'無燈之主',c:'#c9a6ff',pitch:.4,rate:.8}};
CONTENT.dialog={
  intro:[['elder','沐炎，醒醒。墓園的四座燈塔，全熄了。'],['mu','燈塔熄了……那外面的腳步聲是？'],['elder','燈火守著亡者的夢。火一滅，他們就醒了，而且很餓。'],
    ['elder','你現在只會最基本的焰核彈。先清出一條路，再去點亮北邊的焰之塔。'],['mu','好。滑鼠瞄準，左鍵放火。我記得。']],
  t1:[['elder','焰之塔亮了。火會記得點燃它的人，你的焰核彈現在能一次射出三發。'],['mu','身體裡的火變多了。'],['elder','東邊是雷之塔。那裡的火是藍色的，會在亡者之間跳。']],
  t2:[['elder','鏈雷是你的了，右鍵。打中一隻，它會自己找下一隻。'],['mu','灰翁，到底是誰把燈弄熄的？'],['elder','……先點亮南邊的星之塔。答案在天上。']],
  t3:[['elder','按 3，星墜會落在你指的地方。別站在落點上。'],['mu','天上的火掉下來了……燈塔以前是用來接住它們的？'],['elder','聰明。最後一座在西邊，血之塔。那裡的火，要用你自己的心跳去點。']],
  t4:[['elder','血環，按 4。八道血光會替你找到敵人。'],['lord','……四盞燈，又亮了。'],['lord','我花了三百年才把它們吹熄。小小的火，你憑什麼？'],
    ['elder','是無燈之主。沐炎，牠靠吃光活著，別讓牠的紫色衝擊波碰到你！']],
  dark:[['lord','看不見了吧？在黑暗裡，你的火只是一點餘燼。'],['mu','餘燼也是火。']],
  end:[['lord','燈……太亮了……'],['elder','結束了。四座燈塔會守住今晚。'],['mu','那明天呢？'],['elder','明天，你就不是見習生了。']]};
