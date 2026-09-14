// ============================================================================
// 1. XML & DOM Utility
// ============================================================================
const Xml = {
	escape: str => {
		if (!str) return "";
		const entityMap = { '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' };
		return String(str)
			.replace(/&(?!([a-zA-Z]+|#\d+|#[xX][0-9a-fA-F]+);)/g, "&amp;")
			.replace(/[<>'"]/g, c => entityMap[c]);
	},

	safeCdata: (str = "") => str.replaceAll("]]>", "]]]]><![CDATA[>"),
	wrapCdata: str => `<![CDATA[${Xml.safeCdata(str)}]]>`,

	getItems: (xml = "") => xml.match(/<item\b[\s\S]*?<\/item>/gi) || [],

	getItemKey: itemXml => {
		const m = itemXml.match(/<(?:guid|link)[^>]*>([\s\S]*?)<\/(?:guid|link)>/i);
		if (!m) return "";
		const map = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
		return m[1].replace(/&(?:amp|lt|gt|quot|apos);/g, c => map[c] || c).trim();
	},

	getSecondaryId: itemXml => {
		const key = Xml.getItemKey(itemXml);
		const m = key.match(/[?&](?:id|no|seq|docSeq|article(?:No)?|idx|wr_id)=(\d+)/i) 
		       || key.match(/\/(\d+)(?:\.[a-z]+)?(?:\?|$)/i);
		return m ? parseInt(m[1], 10) : 0;
	},

	sanitizeTags: (itemXml, stripHeavy = false) => {
		let res = itemXml;
		if (!/<pubDate\b/i.test(res)) {
			res = res.replace(/<(?:atom:)?published\b[^>]*>/gi, "<pubDate>")
			         .replace(/<\/(?:atom:)?published>/gi, "</pubDate>");
		}
		if (/<content:encoded\b/i.test(res)) {
			res = res.replace(/<description\b[\s\S]*?<\/description>/gi, "")
			         .replace(/<content:encoded\b[^>]*>/gi, "<description>")
			         .replace(/<\/content:encoded>/gi, "</description>");
		}
		if (stripHeavy) {
			res = res.replace(/<(?:script|style|iframe|figure|picture)[^>]*>[\s\S]*?<\/(?:script|style|iframe|figure|picture)>/gi, "")
			         .replace(/<img[^>]*>/gi, "");
		}
		return res;
	},

	// 모든 <item> 태그의 시작 부분에 탭 2개(\t\t) 들여쓰기를 보장하여 채널에 주입
	injectItemsToChannel: (baseXml, items) => {
		const itemsArray = Array.isArray(items) ? items : [items];
		const formattedItems = itemsArray
			.map(block => block.trim())
			.filter(Boolean)
			.map(block => block.startsWith("<item") ? `\t\t${block}` : block)
			.join("\n");

		const cleanBase = (baseXml || "")
			.replace(/^[ \t]*<item\b[\s\S]*?<\/item>\r?\n?/gim, "")
			.replace(/(\r?\n\s*){2,}/g, "\n")
			.trim();

		return /<\/channel>/i.test(cleanBase)
			? cleanBase.replace(/<\/channel>/i, `${formattedItems}\n\t</channel>`)
			: `${cleanBase}\n${formattedItems}`;
	}
};

// ============================================================================
// 2. Date & Time Utility
// ============================================================================
const DateUtil = {
	toRfc822: dateStr => {
		if (!dateStr) return new Date().toUTCString();
		const formatted = dateStr.includes("T") || dateStr.includes("+") ? dateStr : `${dateStr.trim()}T09:00:00Z`;
		const d = new Date(formatted);
		return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
	},

	getTimestamp: target => {
		const str = typeof target === "string" 
			? (target.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? target)
			: target?.pubDate;
		const t = Date.parse((str || "").trim());
		return isNaN(t) ? 0 : t;
	},

	formatNow: () => {
		const now = new Date();
		const pad = n => String(n).padStart(2, "0");
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
	}
};

// ============================================================================
// 3. String & Field Parser
// ============================================================================
const Parser = {
	getDotVal: (obj, path) => path.split('.').reduce((acc, part) => acc?.[part], obj) ?? "",

	resolveUrl: (url, base) => {
		if (!url || !base) return url || "";
		try {
			return new URL(url, base).href;
		} catch {
			return `${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
		}
	},

	extract: (node, pattern, type, docCtx) => {
		if (!pattern) return "";
		if (type === "json") {
			const clean = pattern.replace(/^`|`$/g, "");
			return clean.includes("${") 
				? clean.replace(/\$\{([^}]+)\}/g, (_, p) => Parser.getDotVal(node, p.trim())) 
				: Parser.getDotVal(node, clean);
		}
		if (type === "xpath") {
			try {
				const ctx = docCtx || node.ownerDocument || node;
				return ctx.evaluate(pattern, node, null, XPathResult.STRING_TYPE, null).stringValue.trim();
			} catch {
				return "";
			}
		}
		if (type === "regex") {
			const m = node.match(new RegExp(pattern, "i"));
			return (m?.[1] ?? "").trim();
		}
		return "";
	}
};

// ============================================================================
// 4. GitHub Utility
// ============================================================================
const GitHub = {
	b64Encode: str => btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)))),
	b64Decode: str => decodeURIComponent([...atob(str)].map(c => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")),
	getCommitMessage: () => DateUtil.formatNow()
};

// ============================================================================
// 5. Site Rules & Registry
// ============================================================================
const Sites = {
	dapaBoards: {
		"443": { menuSeq: "3031", title: "공지사항" },
		"326": { menuSeq: "3069", title: "보도자료" },
		"309": { menuSeq: "3070", title: "언론보도설명" },
		"462": { menuSeq: "3042", title: "업무게시판" },
		"243": { menuSeq: "3784", title: "주요정책정보" },
		"362": { menuSeq: "3802", title: "사업정보" },
		"244": { menuSeq: "3829", title: "계약정보" },
		"245": { menuSeq: "3838", title: "행정감시 관련정보" },
		"246": { menuSeq: "3847", title: "기타 공개정보" },
		"363": { menuSeq: "3236", title: "중점관리대상사업목록" },
		"761": { menuSeq: "3054", title: "방위산업통계" }
	},

	createDapaConfig: function (bbsSeq) {
		bbsSeq = String(bbsSeq || "443").trim();
		const b = this.dapaBoards[bbsSeq] || { menuSeq: "3031", title: "공지사항" };
		return {
			feedName: `dapa.go.kr_${b.title}`,
			dataUrl: `https://www.dapa.go.kr/dapa_news/portlet/docList.do?bbsSeq=${bbsSeq}&rownum=10`,
			channelTitle: `방위사업청 ${b.title}`,
			channelLink: `https://www.dapa.go.kr/dapa/doc/selectDocList.do?menuSeq=${b.menuSeq}&bbsSeq=${bbsSeq}`,
			dataType: "json",
			rootPath: "",
			fields: {
				title: "docTitle",
				link: `https://www.dapa.go.kr/dapa/doc/selectDoc.do?docSeq=\${docSeq}&menuSeq=${b.menuSeq}&bbsSeq=\${bbsSeq}`,
				pubDate: "regDt",
				description: "docCn",
				author: "rgtrNm",
				category: "ctgryNm"
			},
			postProcess: items => items
				.map(it => {
					it.description = FeedProcessor.cleanHtml(it.description, /<\/p><p\b[^>]*>\s*<br\/?>\s*<\/p><p\b/.test(it.description));
					return it;
				})
				.filter(it => Boolean(it.title?.trim())),
			testCases: {
				url: `https://www.dapa.go.kr/dapa_news/portlet/docList.do?bbsSeq=${bbsSeq}&rownum=10`,
				method: "GET"
			}
		};
	},

	definitions: {
		"ddaily": {
			feedName: "ddaily.co.kr",
			channelTitle: "디지털데일리",
			channelLink: "https://www.ddaily.co.kr/",
			dataType: "json",
			rootPath: "",
			fields: {
				title: "title",
				link: "https://www.ddaily.co.kr/page/view/${code}",
				pubDate: "publish_date",
				description: "body_text"
			},
			excludeCategories: new Set(["게임", "경제", "공연/전시", "금융", "방송", "생활경제", "증권", "통신*방송"]),
			postProcess: function (items) {
				return items
					.filter(it => !this.excludeCategories.has(it?._raw?.category_name?.trim() || ""))
					.map(it => {
						const raw = it._raw || {};

						try {
							const bylines = typeof raw.by_line_list === "string" ? JSON.parse(raw.by_line_list) : raw.by_line_list;
							if (Array.isArray(bylines)) it.author = bylines.map(v => v.ca_writer_byline).filter(Boolean).join(", ");
						} catch {}

						it.category = raw.category_name || "";

						let figureHtml = "";
						try {
							const photos = typeof raw.rep_photo === "string" ? JSON.parse(raw.rep_photo) : raw.rep_photo;
							if (Array.isArray(photos)) {
								figureHtml = photos.map(v => {
									const filename = (v.filename || "").replace(/(?=\.\w+$)/, "_l");
									const caption = v.caption ? `<figcaption>${v.caption}</figcaption>` : "";
									return `<figure><img src="https://www.ddaily.co.kr/photos/${v.path}/${filename}"/>${caption}</figure>`;
								}).join("");
							}
						} catch {}

						const body = (raw.body_text || "").trim().replace(/\n/g, "<br/>");
						it.description = figureHtml ? `${figureHtml}<br/>\n${body}` : body;

						if (it.pubDate && !it.pubDate.includes("+") && !it.pubDate.includes("Z")) {
							it.pubDate = `${it.pubDate.trim()}+09:00`;
						}
						return it;
					})
					.filter(it => it.title && it.link);
			},
			testCases: {
				url: "https://www.ddaily.co.kr/api.php",
				method: "POST",
				contentType: "application/x-www-form-urlencoded",
				body: "class=/api/getIssuePick"
			}
		}
	},

	resolve: function (siteId, params) {
		if (!siteId) return null;
		if (siteId.startsWith("dapa")) {
			const seq = params?.bbsSeq || siteId.replace(/^dapa_?/, "");
			return this.createDapaConfig(seq);
		}
		return this.definitions[siteId] || null;
	}
};

// ============================================================================
// 6. Core Feed Processor
// ============================================================================
const FeedProcessor = {
	cleanHtml: (html, pToDiv = false) => (html || "").replace(/<\/?([a-zA-Z0-9]+)(?:\s+[^>]*)?>/gi, (m, tag) => {
		tag = tag.toLowerCase();
		const closing = m.startsWith("</");
		if (tag === "a") return closing ? "</a>" : `<a href="${(m.match(/\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[1] || "#"}">`;
		if (pToDiv && tag === "p") return closing ? "</div>" : "<div>";
		if (tag === "br") return "<br/>";
		if (["span", "script", "style"].includes(tag)) return "";
		return closing ? `</${tag}>` : `<${tag}>`;
	}).trim(),

	sortDesc: list => list.sort((a, b) => (b.timestamp - a.timestamp) || (b.secondaryId - a.secondaryId)),

	assembleXml: (channelTitle, channelLink, xmlItems) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
\t<channel>
\t\t<title>${Xml.escape(channelTitle)}</title>
\t\t<link>${Xml.escape(channelLink)}</link>
\t\t<description>${Xml.escape(channelTitle)}</description>
\t\t<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${xmlItems}
\t</channel>
</rss>`,

	itemToXml: it => {
		const authorTag = it.author ? `\n\t\t\t<author>${Xml.escape(it.author)}</author>` : "";
		const categoryTag = it.category ? `\n\t\t\t<category>${Xml.escape(it.category)}</category>` : "";
		return `<item>\n\t\t\t<title>${Xml.escape(it.title)}</title>\n\t\t\t<link>${Xml.escape(it.link)}</link>\n\t\t\t<guid isPermaLink="true">${Xml.escape(it.link)}</guid>${authorTag}${categoryTag}\n\t\t\t<pubDate>${DateUtil.toRfc822(it.pubDate)}</pubDate>\n\t\t\t<description>${Xml.wrapCdata(it.description)}</description>\n\t\t</item>`;
	},

	getFeedName: (siteId, params) => Sites.resolve(siteId, params)?.feedName || siteId,

	// 1. 소스 데이터 파싱
	parse: function (config, rawData) {
		if (!rawData) return [];
		let items = [];

		if (config.dataType === "json") {
			let list = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
			if (config.rootPath) config.rootPath.split(".").forEach(p => list = list?.[p]);
			if (Array.isArray(list)) {
				items = list.map(it => ({
					title: Parser.extract(it, config.fields.title, "json"),
					link: Parser.resolveUrl(Parser.extract(it, config.fields.link, "json"), config.channelLink),
					pubDate: Parser.extract(it, config.fields.pubDate, "json"),
					description: Parser.extract(it, config.fields.description, "json"),
					author: Parser.extract(it, config.fields.author, "json"),
					category: Parser.extract(it, config.fields.category, "json"),
					_raw: it
				}));
			}
		} else if (config.dataType === "xpath") {
			const doc = new DOMParser().parseFromString(rawData, "text/html");
			const nodes = doc.evaluate(config.itemPattern, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
			for (let i = 0; i < nodes.snapshotLength; i++) {
				const node = nodes.snapshotItem(i);
				items.push({
					title: Parser.extract(node, config.fields.title, "xpath", doc).replace(/<[^>]+>/g, ""),
					link: Parser.resolveUrl(Parser.extract(node, config.fields.link, "xpath", doc), config.channelLink),
					pubDate: Parser.extract(node, config.fields.pubDate, "xpath", doc).replace(/<[^>]+>/g, ""),
					description: Parser.extract(node, config.fields.description, "xpath", doc),
					author: Parser.extract(node, config.fields.author, "xpath", doc),
					category: Parser.extract(node, config.fields.category, "xpath", doc),
					_raw: node
				});
			}
		} else if (config.dataType === "regex") {
			const blockRegex = new RegExp(config.itemPattern, "gi");
			const matches = rawData.match(blockRegex) || [];
			items = matches.map(block => ({
				title: Parser.extract(block, config.fields.title, "regex").replace(/<[^>]+>/g, "").trim(),
				link: Parser.resolveUrl(Parser.extract(block, config.fields.link, "regex"), config.channelLink),
				pubDate: Parser.extract(block, config.fields.pubDate, "regex").replace(/<[^>]+>/g, "").trim(),
				description: Parser.extract(block, config.fields.description, "regex"),
				author: Parser.extract(block, config.fields.author, "regex").replace(/<[^>]+>/g, "").trim(),
				category: Parser.extract(block, config.fields.category, "regex").replace(/<[^>]+>/g, "").trim(),
				_raw: block
			}));
		}

		return items;
	},

	// 2. 단일 피드 빌드
	buildFeed: function (siteId, rawData, oldRss, params) {
		const config = Sites.resolve(siteId, params);
		if (!config || !rawData) return { xml: oldRss || "", isChanged: false };

		let items = this.parse(config, rawData);
		if (config.postProcess) items = config.postProcess(items);

		const oldRawItems = Xml.getItems(oldRss);
		const seenKeys = new Set();
		const mergedList = [];

		items.forEach(it => {
			if (it.link && !seenKeys.has(it.link)) {
				seenKeys.add(it.link);
				mergedList.push({ isRaw: true, item: it, key: it.link, timestamp: DateUtil.getTimestamp(it), secondaryId: Xml.getSecondaryId(it.link) });
			}
		});

		oldRawItems.forEach(xml => {
			const key = Xml.getItemKey(xml);
			if (key && !seenKeys.has(key)) {
				seenKeys.add(key);
				mergedList.push({ isRaw: false, xml, key, timestamp: DateUtil.getTimestamp(xml), secondaryId: Xml.getSecondaryId(xml) });
			}
		});

		const top10 = this.sortDesc(mergedList).slice(0, 10);
		const isChanged = oldRawItems.slice(0, 10).map(Xml.getItemKey).join("|") !== top10.map(it => it.key).join("|");

		// 신규 생성 및 기존 항목 모두 앞에 \t\t 들여쓰기 강제 보정
		const xmlItems = top10.map(entry => {
			const rawXml = entry.isRaw ? this.itemToXml(entry.item) : entry.xml;
			const trimmed = rawXml.trim();
			return trimmed.startsWith("<item") ? `\t\t${trimmed}` : trimmed;
		}).join("\n");

		return { xml: this.assembleXml(config.channelTitle, config.channelLink, xmlItems), isChanged };
	},

	// 3. 다중 피드 병합
	mergeFeeds: function (feedXmlList, baseXml, limit = 10) {
		const seenKeys = new Set();
		const mergedList = [];

		(feedXmlList || []).forEach(xml => {
			Xml.getItems(xml).forEach(itemXml => {
				const cleaned = Xml.sanitizeTags(itemXml);
				const key = Xml.getItemKey(cleaned);
				if (key && !seenKeys.has(key)) {
					seenKeys.add(key);
					mergedList.push({ xml: cleaned, timestamp: DateUtil.getTimestamp(cleaned), secondaryId: Xml.getSecondaryId(cleaned) });
				}
			});
		});

		const topItems = this.sortDesc(mergedList).slice(0, limit).map(it => it.xml);
		const base = baseXml || feedXmlList?.[0] || "";
		return Xml.injectItemsToChannel(base, topItems);
	},

	// 4. 피드 경량화 최적화
	optimizeFeed: function (newXml, oldXml, limit = 10) {
		if (!newXml) return { xml: oldXml || "", isChanged: false };
		const newRaw = Xml.getItems(newXml);
		const oldRaw = Xml.getItems(oldXml);
		const seenKeys = new Set();
		const mergedList = [];

		[...newRaw, ...oldRaw].forEach(itemXml => {
			const cleaned = Xml.sanitizeTags(itemXml, true);
			const key = Xml.getItemKey(cleaned);
			if (key && !seenKeys.has(key)) {
				seenKeys.add(key);
				mergedList.push({ xml: cleaned, key, timestamp: DateUtil.getTimestamp(cleaned), secondaryId: Xml.getSecondaryId(cleaned) });
			}
		});

		const topItems = this.sortDesc(mergedList).slice(0, limit);
		const isChanged = oldRaw.slice(0, limit).map(Xml.getItemKey).join("|") !== topItems.map(it => it.key).join("|");

		return { xml: Xml.injectItemsToChannel(newXml, topItems.map(it => it.xml)), isChanged };
	},

	// 5. GitHub 동기화 페이로드 생성
	prepareGithubPayload: function (newContent, httpData, httpCode) {
		if (!newContent) return { shouldSkip: true, payload: "" };

		let currentSha = "";
		let oldContent = "";

		if (httpData && (!httpCode || String(httpCode) === "200")) {
			try {
				const resData = JSON.parse(httpData);
				currentSha = resData.sha || "";
				if (resData.content) {
					oldContent = GitHub.b64Decode(resData.content.replace(/\s/g, ""));
				}
			} catch {}
		}

		const oldItems = Xml.getItems(oldContent);
		const newItems = Xml.getItems(newContent);
		const itemMap = new Map();

		for (const xml of oldItems) {
			const key = Xml.getItemKey(xml);
			if (key) itemMap.set(key, xml);
		}
		for (const xml of newItems) {
			const key = Xml.getItemKey(xml);
			if (key) itemMap.set(key, xml);
		}

		const mergedList = [...itemMap.values()].map(xml => ({
			xml,
			timestamp: DateUtil.getTimestamp(xml),
			secondaryId: Xml.getSecondaryId(xml)
		}));

		const top10 = this.sortDesc(mergedList).slice(0, 10);
		const oldKeys = oldItems.slice(0, 10).map(Xml.getItemKey).join("|");
		const newKeys = top10.map(it => Xml.getItemKey(it.xml)).join("|");

		if (currentSha && oldKeys && oldKeys === newKeys) {
			return { shouldSkip: true, payload: "" };
		}

		const baseXml = newContent || oldContent;
		const finalFeedXml = Xml.injectItemsToChannel(baseXml, top10.map(it => it.xml));

		const payloadObj = {
			message: GitHub.getCommitMessage(),
			content: GitHub.b64Encode(finalFeedXml),
			...(currentSha && { sha: currentSha })
		};

		return { shouldSkip: false, payload: JSON.stringify(payloadObj) };
	}
};

// ============================================================================
// 7. Tasker 인터페이스 래퍼
// ============================================================================
const mergeFeeds = (list, base, limit) => FeedProcessor.mergeFeeds(list, base, limit);

function getFeedName(siteId, params) {
	const feed_name = FeedProcessor.getFeedName(siteId, params);
	if (typeof setLocal === "function") {
		setLocal("%feed_name", feed_name);
	}
	return feed_name;
}

function optimizeFeed(new_xml, old_xml, limit = 10) {
	const result = FeedProcessor.optimizeFeed(new_xml, old_xml, limit);
	if (typeof setLocal === "function") {
		setLocal("%feed_changed", String(result.isChanged));
		setLocal("%feed_xml", result.xml);
		setLocal("%feed_xml_length", String(result.xml.length));
	}
	return result;
}

function buildFeed(siteId, http_data = "", old_xml = "", params = {}) {
	const result = FeedProcessor.buildFeed(siteId, http_data, old_xml, params);
	if (typeof setLocal === "function") {
		setLocal("%feed_changed", String(result.isChanged));
		setLocal("%feed_xml", result.xml);
		setLocal("%feed_xml_length", String(result.xml.length));
	}
	return result;
}

function prepareGithubPayload(content = "", http_data = "", http_response_code = "") {
	const result = FeedProcessor.prepareGithubPayload(content, http_data, String(http_response_code));
	if (typeof setLocal === "function") {
		setLocal("%should_skip", String(result.shouldSkip));
		setLocal("%gh_payload", result.payload);
	}
	return result;
}

let main = function() {
	function testWithFetch(siteId) {
		const conf = Sites.resolve(siteId);
		fetch(`https://corsproxy.io/?${encodeURIComponent(conf.testCases.url)}`)
			.then(r => r.text())
			.then(data => console.log("Result XML:\n", buildFeed("dapa_443", data, "").xml))
			.catch(console.error);
	}

	function testWithMockData(siteId) {
		let params = {};
		if (siteId === "dapa") {
			params = {bbsSeq: "326"};
		}
		console.clear();
		const feedName = FeedProcessor.getFeedName(siteId, params);
		console.log(feedName);
		const http_data = JSON.stringify(http_data_obj);
		const result = FeedProcessor.buildFeed(siteId, http_data, "", params);
		console.log(result.isChanged);
		console.log(result.xml);
	}

	// 브라우저 Playground 테스트 러너
	if (typeof window !== "undefined" && !window.Tasker) {
		testWithMockData("ddaily");
	}
}
