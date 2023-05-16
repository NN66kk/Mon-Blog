# 🏡主页

- 2023-05-15 ：[2023-05-15-周一](2023-05-15-%E5%91%A8%E4%B8%80.md)
- 2023-05-14 ：[2023-05-14-周日](2023-05-14-%E5%91%A8%E6%97%A5.md)
- 2023-05-13 ：[2023-05-13-周六](2023-05-13-%E5%91%A8%E5%85%AD.md)
- 2023-05-12 ：[2023-05-12-周五](2023-05-12-%E5%91%A8%E4%BA%94.md)
- 2023-05-12 ：[000田静长难句系列](000%E7%94%B0%E9%9D%99%E9%95%BF%E9%9A%BE%E5%8F%A5%E7%B3%BB%E5%88%97.md)
- 2023-05-11 ：[2023-05-11-周四](2023-05-11-%E5%91%A8%E5%9B%9B.md)
- 2023-05-10 ：[2023-05-10-周三](2023-05-10-%E5%91%A8%E4%B8%89.md)
- 2023-05-09 ：[2023-05-09-周二](2023-05-09-%E5%91%A8%E4%BA%8C.md)
- 2023-05-08 ：[2023-05-08-周一](2023-05-08-%E5%91%A8%E4%B8%80.md)
- 2023-05-07 ：[2023-05-07-周日](2023-05-07-%E5%91%A8%E6%97%A5.md)
- 2023-05-06 ：[2023-05-06-周六](2023-05-06-%E5%91%A8%E5%85%AD.md)
- 2023-05-05 ：[2023-05-05-周五](2023-05-05-%E5%91%A8%E4%BA%94.md)
- 2023-05-04 ：[2023-05-04-周四](2023-05-04-%E5%91%A8%E5%9B%9B.md)
- 2023-05-04 ：[鸡蛋能不能用微波炉加热？](鸡蛋能不能用微波炉加热？.md)
- 2023-05-03 ：[2023-05-03-周三](2023-05-03-%E5%91%A8%E4%B8%89.md)
- 2023-05-02 ：[2023-05-02-周二](2023-05-02-%E5%91%A8%E4%BA%8C.md)
- 2023-05-01 ：[2023-05-01-周一](2023-05-01-%E5%91%A8%E4%B8%80.md)

```jsx:component:DigitalClock
const [date, setDate] = useState(new Date)
useEffect(()=>{
	const timerId2 = setInterval(()=>{
		setDate(new Date)
	},1000)
	return ()=>{clearInterval(timerId2)}
})

//moment.locale('en-us');
moment.locale('zh-cn');
let formatDate = moment().format("dddd-MMM-DD-H-mm-ss-a").split("-")
let secProgress = formatDate[5] / 60
let minProgress = (formatDate[4]) / 60
let hourProgress = (formatDate[3]) / 24
let dayProgress = (formatDate[2]) / 31
//console.log(formatDate[2]/31)

return (
<div className="DPDC" cityid="9701" lang="en" id="DigitalClock" ampm="false" nightsign="true" sun="false">
	<div className="DPDCt">
		<span className="DPDCth">{formatDate[3]}</span><span className="DPDCtm">{formatDate[4]}</span><span className="DPDCts">{formatDate[5]}</span>
	</div>
	<div className="DPDCd">
		<span className="DPDCdt">{formatDate[1]}{formatDate[2]}  {formatDate[0]}</span>
	</div>
	</div>
)
```

## 调用方式

```jsx:
<DigitalClock></DigitalClock>
```
