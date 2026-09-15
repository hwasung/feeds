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
		if (!m || !m[1]) return "";
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

	formatItemBlock: xmlStr => {
		const trimmed = (xmlStr || "").trim();
		return trimmed.startsWith("<item") ? `\t\t${trimmed}` : trimmed;
	},

	injectItemsToChannel: (baseXml, items) => {
		const itemsArray = Array.isArray(items) ? items : [items];
		const formattedItems = itemsArray
			.map(Xml.formatItemBlock)
			.filter(Boolean)
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
			: (target?.date || target?.pubDate);
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
		if (!url) return "";
		url = String(url).trim();
		if (!base || /^https?:\/\//i.test(url)) return url;
		try {
			return new URL(url, base).href;
		} catch {
			return `${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
		}
	},

	jsonField: (item, pattern) => {
		if (!pattern) return "";
		const clean = pattern.replace(/^`|`$/g, "").trim();
		return clean.includes("${")
			? clean.replace(/\$\{([^}]+)\}/g, (_, p) => Parser.getDotVal(item, p.trim()))
			: Parser.getDotVal(item, clean);
	},

	xpathField: (node, pattern, docCtx) => {
		if (!pattern) return "";
		try {
			const ctx = docCtx || node.ownerDocument || node;
			const res = ctx.evaluate(pattern, node, null, XPathResult.ANY_TYPE, null);

			if (res.resultType === XPathResult.STRING_TYPE) return res.stringValue.trim();
			if (res.resultType === XPathResult.NUMBER_TYPE) return String(res.numberValue);
			if (res.resultType === XPathResult.BOOLEAN_TYPE) return String(res.booleanValue);

			if (res.resultType === XPathResult.UNORDERED_NODE_ITERATOR_TYPE || 
			    res.resultType === XPathResult.ORDERED_NODE_ITERATOR_TYPE) {
				const parts = [];
				let n;
				while ((n = res.iterateNext())) {
					if (n.nodeType === 1) parts.push(n.outerHTML);
					else if (n.nodeType === 2) parts.push(n.nodeValue);
					else if (n.nodeType === 3) parts.push(n.nodeValue.trim());
				}
				return parts.filter(Boolean).join("\n");
			}
			return res.stringValue ? res.stringValue.trim() : "";
		} catch {
			return "";
		}
	},

	regexField: (block, pattern) => {
		if (!pattern) return "";
		const m = block.match(new RegExp(pattern, "i"));
		return (m?.[1] ?? "").trim();
	},

	parse: function (config, rawData) {
		if (!rawData) return [];
		let items = [];
		const f = config.fields;

		if (config.dataType === "json") {
			let list = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
			if (config.rootPath) config.rootPath.split(".").forEach(p => list = list?.[p]);

			if (Array.isArray(list)) {
				items = list.map(it => ({
					title: this.jsonField(it, f.title),
					link: this.resolveUrl(this.jsonField(it, f.link), config.link),
					date: this.jsonField(it, f.date),
					description: this.jsonField(it, f.description),
					author: this.jsonField(it, f.author),
					category: this.jsonField(it, f.category),
					_raw: it
				}));
			}
		} else if (config.dataType === "xpath") {
			const doc = new DOMParser().parseFromString(rawData, "text/html");
			const nodes = doc.evaluate(config.itemPattern, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

			for (let i = 0; i < nodes.snapshotLength; i++) {
				const node = nodes.snapshotItem(i);
				items.push({
					title: this.xpathField(node, f.title, doc).replace(/<[^>]+>/g, "").trim(),
					link: this.resolveUrl(this.xpathField(node, f.link, doc), config.link),
					date: this.xpathField(node, f.date, doc).replace(/<[^>]+>/g, "").trim() || (f.date ? new Date().toISOString() : ""),
					description: this.xpathField(node, f.description, doc),
					author: this.xpathField(node, f.author, doc).replace(/<[^>]+>/g, "").trim(),
					category: this.xpathField(node, f.category, doc).replace(/<[^>]+>/g, "").trim(),
					_raw: node
				});
			}
		} else if (config.dataType === "regex") {
			const matches = rawData.match(new RegExp(config.itemPattern, "gi")) || [];
			items = matches.map(block => ({
				title: this.regexField(block, f.title).replace(/<[^>]+>/g, "").trim(),
				link: this.resolveUrl(this.regexField(block, f.link), config.link),
				date: this.regexField(block, f.date).replace(/<[^>]+>/g, "").trim(),
				description: this.regexField(block, f.description),
				author: this.regexField(block, f.author).replace(/<[^>]+>/g, "").trim(),
				category: this.regexField(block, f.category).replace(/<[^>]+>/g, "").trim(),
				_raw: block
			}));
		}

		return items.filter(it => Boolean(it.title && it.link));
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
// 5. Site Rules Registry & Helpers
// ============================================================================
const Sites = {
	define: function ({
		id,
		title,
		link,
		interval = "hourly",
		feedName = id,
		dataType = "xpath",
		itemPattern = "",
		fields = {},
		request = null,
		postProcess = null,
		sources = null,
		defaultRule = null
	}) {
		const isMulti = Array.isArray(sources) && sources.length > 0;
		return {
			feedName,
			title,
			link,
			interval,
			dataType,
			isMulti,
			sources,
			defaultRule: defaultRule || {
				itemPattern,
				fields: {
					title: fields.title || "a/text()",
					link: fields.link || "a/@href",
					date: fields.date || fields.pubDate || "",
					description: fields.description || fields.desc || "",
					author: fields.author || "",
					category: fields.category || ""
				}
			},
			itemPattern,
			fields: {
				title: fields.title || "a/text()",
				link: fields.link || "a/@href",
				date: fields.date || fields.pubDate || "",
				description: fields.description || fields.desc || "",
				author: fields.author || "",
				category: fields.category || ""
			},
			request: request || {
				url: link,
				method: "GET",
				headers: { "User-Agent": "Mozilla/5.0" },
				body: ""
			},
			postProcess
		};
	},

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

    defineDapaBoard: function (bbsSeq, interval = "hourly") {
        bbsSeq = String(bbsSeq || "443").trim();
        const board = this.dapaBoards[bbsSeq] || { menuSeq: "3031", title: "공지사항" };

        return this.define({
            id: `dapa.go.kr_${board.title}`,
            feedName: `dapa.go.kr_${board.title}`,
            title: `방위사업청 ${board.title}`,
            link: `https://www.dapa.go.kr/dapa/doc/selectDocList.do?menuSeq=${board.menuSeq}&bbsSeq=${bbsSeq}`,
            interval: interval,
            dataType: "json",
            request: {
                url: `https://www.dapa.go.kr/dapa_news/portlet/docList.do?bbsSeq=${bbsSeq}&rownum=10`,
                method: "GET",
                headers: { "Referer": "https://www.dapa.go.kr/" },
                body: ""
            },
            fields: {
                title: "docTitle",
                link: `https://www.dapa.go.kr/dapa/doc/selectDoc.do?docSeq=\${docSeq}&menuSeq=${board.menuSeq}&bbsSeq=\${bbsSeq}`,
                date: "regDt",
                description: "docCn",
                author: "rgtrNm",
                category: "ctgryNm"
            },
            postProcess: items => items
                .map(it => {
                    it.description = FeedProcessor.cleanHtml(it.description, /<\/p><p\b[^>]*>\s*<br\/?>\s*<\/p><p\b/.test(it.description));
                    return it;
                })
                .filter(it => Boolean(it.title?.trim()))
        });
    },

	definitions: {},

    resolve: function (siteId, params) {
		if (!siteId) return null;
		if (this.definitions[siteId]) return this.definitions[siteId];
		if (siteId.startsWith("dapa")) {
			const seq = params?.bbsSeq || siteId.replace(/^dapa_?/, "");
			return this.defineDapaBoard(seq);
		}
		return null;
	},

	getByInterval: function (interval) {
		return Object.keys(this.definitions).filter(key => this.definitions[key].interval === interval);
	},

	exportRequest: function (siteId, params) {
		const conf = this.resolve(siteId, params);
		if (!conf) return null;

		let requests = [];
		if (conf.isMulti) {
			requests = conf.sources.map(src => ({
				url: src.url,
				method: src.method || "GET",
				headers: src.headers || { "User-Agent": "Mozilla/5.0" },
				body: src.body || "",
				category: src.category || ""
			}));
		} else if (conf.request) {
			requests.push({
				url: conf.request.url,
				method: conf.request.method || "GET",
				headers: conf.request.headers || { "User-Agent": "Mozilla/5.0" },
				body: conf.request.body || "",
				category: ""
			});
		}

		return {
			feedName: conf.feedName || siteId,
			interval: conf.interval,
			isMulti: Boolean(conf.isMulti),
			requests
		};
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

	assembleXml: (title, link, xmlItems) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
\t<channel>
\t\t<title>${Xml.escape(title)}</title>
\t\t<link>${Xml.escape(link)}</link>
\t\t<description>${Xml.escape(title)}</description>
\t\t<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${xmlItems}
\t</channel>
</rss>`,

	itemToXml: it => {
		const authorTag = it.author ? `\n\t\t\t<author>${Xml.escape(it.author)}</author>` : "";
		const categoryTag = it.category ? `\n\t\t\t<category>${Xml.escape(it.category)}</category>` : "";
        const pubDateTag = it.date ? `\n\t\t\t<pubDate>${DateUtil.toRfc822(it.date)}</pubDate>` : "";
		return `<item>\n\t\t\t<title>${Xml.escape(it.title)}</title>\n\t\t\t<link>${Xml.escape(it.link)}</link>\n\t\t\t<guid isPermaLink="true">${Xml.escape(it.link)}</guid>${authorTag}${categoryTag}${pubDateTag}\n\t\t\t<description>${Xml.wrapCdata(it.description)}</description>\n\t\t</item>`;
	},

	getFeedName: (siteId, params) => Sites.resolve(siteId, params)?.feedName || siteId,

	buildFeed: function (siteId, rawData, oldRss, params) {
		const config = Sites.resolve(siteId, params);
		if (!config || !rawData) return { xml: oldRss || "", isChanged: false };

		let items = [];

		if (config.isMulti) {
			const dataList = Array.isArray(rawData) ? rawData : [rawData];
			config.sources.forEach((src, idx) => {
				const subRaw = dataList[idx];
				if (!subRaw) return;

				const pageConfig = {
					dataType: src.dataType || config.dataType || "xpath",
					itemPattern: src.itemPattern || config.defaultRule.itemPattern,
					link: config.link,
					fields: Object.assign({}, config.defaultRule.fields, src.fields || {})
				};

				const parsed = Parser.parse(pageConfig, subRaw);
				parsed.forEach(it => {
					if (src.category && !it.category) it.category = src.category;
				});
				items = items.concat(parsed);
			});
		} else {
			const singleRaw = Array.isArray(rawData) ? rawData[0] : rawData;
			items = Parser.parse(config, singleRaw);
		}

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

		const xmlItems = top10.map(entry => {
			const rawXml = entry.isRaw ? this.itemToXml(entry.item) : entry.xml;
			return Xml.formatItemBlock(rawXml);
		}).join("\n");

		return { xml: this.assembleXml(config.title, config.link, xmlItems), isChanged };
	},

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
/*
function buildFeed(siteId, http_data = "", old_xml = "", params = {}) {
	let rawData = http_data;
	if (typeof rawData === "string" && rawData.startsWith("[") && rawData.endsWith("]")) {
		try { rawData = JSON.parse(rawData); } catch {}
	}
	const result = FeedProcessor.buildFeed(siteId, rawData, old_xml, params);
	if (typeof setLocal === "function") {
		setLocal("%feed_changed", String(result.isChanged));
		setLocal("%feed_xml", result.xml);
		setLocal("%feed_xml_length", String(result.xml.length));
	}
	return result;
}
*/
function prepareGithubPayload(content = "", http_data = "", http_response_code = "") {
	const res = FeedProcessor.prepareGithubPayload(content, http_data, String(http_response_code));
	if (typeof setLocal === "function") {
		setLocal("%should_skip", String(res.shouldSkip));
		setLocal("%gh_payload", res.payload);
	}
	return res;
}

// 사이트 요청 정보 초기화
function initFeed(siteId) {
	const targetId = siteId || (typeof par1 !== "undefined" && par1 && par1 !== "%par1" ? par1 : (typeof local === "function" ? local("%par1") : "dapa_443"));
	const reqInfo = Sites.exportRequest(targetId);

	if (reqInfo) {
		if (typeof setLocal === "function") {
			setLocal("%feed_name", reqInfo.feedName);
			setLocal("%req_list_json", JSON.stringify(reqInfo.requests));
			setLocal("%req_count", String(reqInfo.requests.length));
			setLocal("%res_list_json", "[]");
		}
		return reqInfo;
	} else {
		if (typeof flash === "function") flash("사이트 설정을 찾을 수 없음: " + targetId);
		if (typeof exit === "function") exit();
		return null;
	}
}

// 루프 내부: 현재 순번의 HTTP 요청 파라미터 준비
function prepareRequest(idx) {
	const reqListJson = typeof local === "function" ? local("%req_list_json") : "[]";
	const reqs = JSON.parse(reqListJson);
	const targetIdx = (typeof idx !== "undefined") ? parseInt(idx, 10) : (typeof local === "function" ? parseInt(local("%req_idx"), 10) - 1 : 0);
	const cur = reqs[targetIdx] || reqs[0] || {};

	const headersStr = Object.entries(cur.headers || {})
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");

	if (typeof setLocal === "function") {
		setLocal("%cur_url", cur.url || "");
		setLocal("%cur_method", cur.method || "GET");
		setLocal("%cur_headers", headersStr);
		setLocal("%cur_body", cur.body || "");
	}
	return cur;
}

// 루프 내부: 수집된 개별 응답 누적
function collectResponse(data) {
	const resListJson = typeof local === "function" ? local("%res_list_json") : "[]";
	const resList = JSON.parse(resListJson);
	const subRes = (typeof data !== "undefined") 
		? data 
		: (typeof http_data !== "undefined" && http_data !== "%http_data" ? http_data : (typeof local === "function" ? local("%http_data") : ""));

	resList.push(subRes);
	
	if (typeof setLocal === "function") {
		setLocal("%res_list_json", JSON.stringify(resList));
	}
	return resList;
}

// 피드 생성: 수집된 데이터와 기존 RSS를 병합하여 최종 XML 생성
function buildFeed(siteId, resListJson, oldRssXml, params = {}) {
	const targetId = siteId || (typeof par1 !== "undefined" && par1 && par1 !== "%par1" ? par1 : (typeof local === "function" ? local("%par1") : "dapa_443"));
	
	// 수집된 응답 목록(JSON 배열) 파싱
	const rawJsonList = resListJson || (typeof local === "function" ? local("%res_list_json") : "[]");
	let resList = [];
	try {
		resList = typeof rawJsonList === "string" ? JSON.parse(rawJsonList) : rawJsonList;
	} catch (e) {
		resList = [rawJsonList];
	}

	// 기존 피드 XML 참조
	const oldXml = (typeof oldRssXml !== "undefined") 
		? oldRssXml 
		: (typeof old_xml !== "undefined" && old_xml !== "%old_xml" ? old_xml : (typeof local === "function" ? local("%old_xml") : ""));

	// 코어 피드 빌드 실행
	const result = FeedProcessor.buildFeed(targetId, resList, oldXml, params);

	// Tasker 변수 세팅
	if (typeof setLocal === "function") {
		setLocal("%feed_changed", String(result.isChanged));
		setLocal("%feed_xml", result.xml);
		setLocal("%feed_xml_length", String(result.xml.length));
	}

	return result;
}

// 주기별 사이트 ID 목록 추출
function getTargets(interval) {
	const targetInterval = interval || (typeof par1 !== "undefined" && par1 && par1 !== "%par1" ? par1 : (typeof local === "function" ? local("%par1") : "hourly"));
	const targets = Sites.getByInterval(targetInterval);
	const targetListStr = targets.join(",");

	if (typeof setLocal === "function") {
		setLocal("%target_list", targetListStr);
	}
	return targetListStr;
}

// ============================================================================
// 사이트 레지스트리 일괄 등록
// ============================================================================
[
    // 방위사업청
    Sites.defineDapaBoard("443", "hourly"), // 공지사항
    Sites.defineDapaBoard("326", "hourly"), // 보도자료
    Sites.defineDapaBoard("309", "hourly"), // 언론보도설명
    Sites.defineDapaBoard("462", "daily"),  // 업무게시판
    Sites.defineDapaBoard("243", "daily"),  // 주요정책정보
    Sites.defineDapaBoard("362", "daily"),  // 사업정보
    Sites.defineDapaBoard("244", "daily"),  // 계약정보
    Sites.defineDapaBoard("245", "daily"),  // 행정감시 관련정보
    Sites.defineDapaBoard("246", "daily"),  // 기타 공개정보
    Sites.defineDapaBoard("363", "daily"),  // 중점관리대상사업목록
    Sites.defineDapaBoard("761", "weekly"), // 방위산업통계

	// 디지털데일리
	{
		id: "ddaily.co.kr",
		title: "디지털데일리",
		link: "https://www.ddaily.co.kr/",
		interval: "frequently",
		feedName: "ddaily.co.kr",
		dataType: "json",
		request: {
			url: "https://www.ddaily.co.kr/api.php",
			method: "POST",
			headers: {
                "Referer": "https://www.ddaily.co.kr/",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            },
			body: "class=/api/getIssuePick"
		},
		fields: {
			title: "title",
			link: "https://www.ddaily.co.kr/page/view/${code}",
			date: "publish_date",
			description: "body_text"
		},
		postProcess: function (items) {
			const exclude = new Set(["게임", "경제", "공연/전시", "금융", "방송", "산업/재계", "생활경제", "증권", "통신*방송"]);
			return items
				.filter(it => !exclude.has(it?._raw?.category_name?.trim() || ""))
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

					if (it.date && !it.date.includes("+") && !it.date.includes("Z")) {
						it.date = `${it.date.trim()}+09:00`;
					}
					return it;
				})
				.filter(it => it.title && it.link);
		}
	},

	// 국방기술진흥연구소 (KRIT) - 다중 페이지 통합 피드
	Sites.define({
		id: "krit.re.kr",
		title: "국방기술진흥연구소 발간물",
		link: "https://www.krit.re.kr/krit/bbs/publication_list.do",
		interval: "daily",
		dataType: "xpath",
		defaultRule: {
			itemPattern: "//ul[contains(@class, 'imgList')]/li",
			fields: {
				title: "img/@alt",
				link: "div/a[contains(@href, '/')]/@href",
				description: "concat('<img src=\"https://www.krit.re.kr', img/@src, '\" style=\"max-height: 300px\">', '<ul><li>발행기관: 국방기술진흥연구소</li><li>발행일자: ', div/span[2]/text(), '</li></ul>')"
			}
		},
		sources: [
			{ category: "국방과학기술정보", url: "https://www.krit.re.kr/krit/bbs/publication_list.do?gotoMenuNo=03060000" },
			{ category: "국방과학기술조사서", url: "https://www.krit.re.kr/krit/bbs/gbgh_list.do?gotoMenuNo=03090200" },
			{ category: "국방기술기획서", url: "https://www.krit.re.kr/krit/bbs/gbgs_list.do?gotoMenuNo=03090100" },
			{ category: "국방분야 전문분석지", url: "https://www.krit.re.kr/krit/bbs/gbby_list.do?gotoMenuNo=03090300" },
			{ category: "기타발간물", url: "https://www.krit.re.kr/krit/bbs/book_list.do?gotoMenuNo=03070000" },
			{ category: "이슈페이퍼", url: "https://www.krit.re.kr/krit/bbs/brief1_list.do?gotoMenuNo=03040000" }
		]
	}),

	// 3. 국민참여입법센터
	Sites.define({
		id: "lawmaking.go.kr_(부처)행정예고",
		title: "국민참여입법센터 (부처)행정예고",
		link: "https://opinion.lawmaking.go.kr/gcom/admpp?asndOfiNm=%EB%B0%A9%EC%9C%84%EC%82%AC%EC%97%85%EC%B2%AD",
		itemPattern: '//tr/td[@class="subject"]',
		fields: { title: "a/text()", link: "a/@href" }
	}),
	Sites.define({
		id: "lawmaking.go.kr_(부처)입법예고",
		title: "국민참여입법센터 (부처)입법예고",
		link: "https://opinion.lawmaking.go.kr/gcom/ogLmPp?cptOfiOrgCd=1690000",
		itemPattern: '//tr/td[@class="subject"]',
		fields: { title: "a/text()", link: "a/@href" }
	}),

	// 4. 국방기술품질원 (DTAQ)
	Sites.define({
		id: "dtaq.re.kr",
		title: "국방기술품질원 발간물·단행본",
		link: "https://www.dtaq.re.kr/ko/doc/report.jsp",
		itemPattern: "//tr",
		fields: {
			title: "td[3]/text()",
			link: "td[5]/a/@href",
            date: "td[4]",
			description: "concat('<img src=\"https://www.dtaq.re.kr', td[2]/img/@src, '\" style=\"max-height: 300px\"/><br/>발간일자: ', td[4]/text())"
		}
	}),

	// 5. 언론사 및 포털
	Sites.define({
		id: "g-enews.com",
		title: "글로벌이코노믹",
		link: "https://www.g-enews.com/issuelist.php?ud=2019041402134303045&ct=g000000",
        itemPattern: "//div[@class='l_lt']//a[span and starts-with(@href, 'https://www.g-enews.com/article/')]/parent::*",
		fields: { title: "a[1]/span/text()", link: "a[1]/@href", date: "../div/p/text()" }
	}),
	Sites.define({
		id: "news2day.co.kr",
		title: "뉴스투데이 - 시큐리티팩트",
		link: "https://www.news2day.co.kr/list/23",
		itemPattern: "//section/ul/li/a | //section/ul/li/div/a",
		fields: {
			title: "div/@title",
			link: "concat('https://www.news2day.co.kr/article/', substring-before(substring-after(@href, \"'\"), \"'\"))",
			description: "p/text() | ../../dl/dd[@class='text']/text()"
		}
	}),
	Sites.define({
		id: "theguru.co.kr",
		title: "더구루 - K-방산",
		link: "https://theguru.co.kr/news/section.html?sec_no=108",
		itemPattern: "//a[contains(@href, '/news/article.html')]",
		fields: { title: ".//h2/text() | .//h4/text()", link: "@href", description: ".//img | ../../../a//img" }
	}),
	Sites.define({
		id: "donga.com",
		title: "동아일보 - 윤상호 군사전문기자",
		link: "https://www.donga.com/news/search?query=%EC%9C%A4%EC%83%81%ED%98%B8%20%EA%B5%B0%EC%82%AC%EC%A0%84%EB%AC%B8%EA%B8%B0%EC%9E%90",
		itemPattern: "//article",
		fields: { title: "div/h4//text()", link: "div/h4/a/@href", description: "div/p" }
	}),
	Sites.define({
		id: "segye.com",
		title: "세계일보 - 국방",
		link: "https://www.segye.com/boxTemplate/newsList/box/newsList.do?dataPath=0101010700000&dataId=0101010700000&listSize=10&naviSize=10&page=null&dataType=list",
		itemPattern: "//ul/li",
		fields: { title: "a/strong/text()", link: "a/@href", description: "small/text()" }
	}),
	Sites.define({
		id: "asiae.co.kr",
		title: "아시아경제 - 양낙규 기자",
		link: "https://www.asiae.co.kr/search/index.htm?keyword=%EC%96%91%EB%82%99%EA%B7%9C",
		itemPattern: "//div[contains(@class, 'article_type')]",
		fields: {
			title: "div/h1/a/@title",
			link: "concat('https://', substring-after(div/h1/a/@href, '//'))",
			description: "./*"
		}
	}),
	Sites.define({
		id: "edaily.co.kr",
		title: "이데일리 - 김관용 기자",
		link: "https://www.edaily.co.kr/search/index?keyword=%EA%B9%80%EA%B4%80%EC%9A%A9&jname=%EA%B9%80%EA%B4%80%EC%9A%A9",
		itemPattern: "//div[@id=\"newsList\"]/div",
		fields: { title: "a/ul/li[1]/text()", link: "a/@href", description: ".//img | a/ul/li[2]/text()" }
	}),
	Sites.define({
		id: "policy.nl.go.kr_국방",
		title: "정책정보포털 - 최신정책동향 - 국방",
		link: "https://policy.nl.go.kr/pages/trend/newest.jsp?bbsSe=5&brmCode1=0005",
		itemPattern: "//form/ul/li",
		fields: { title: "dl/dt/a/text()", link: "dl/dt/a/@href", description: "div//img | dl/dd/ul | dl/dd/div/a[contains(@href, 'down')]" }
	}),
	Sites.define({
		id: "kida.re.kr",
		title: "한국국방연구원 발간물",
		link: "https://www.kida.re.kr/",
		itemPattern: "//div[@class='book_area']/div/ul/li/ul/li[@class='book_list']",
		fields: {
			title: ".//a/@title",
			link: "concat('https://www.kida.re.kr/', substring-after(.//a/@href, '/'), substring-after(.//a/@href, 'javascript:'))",
			description: "concat('<ul><li>저자: ', .//span[@class='name subject']/text(), '</li><li>발행일자: ', .//span[@class='day']/text(), '</li></ul>')"
		}
	}),

	// 6. 방위사업청 기타
	Sites.define({
		id: "dapa.go.kr_업무가이드북",
		title: "방위사업청 업무가이드북",
		link: "https://www.dapa.go.kr/dapa/pcm/pblictn/pblictnListView.do?seq=3&menuSeq=3043",
		itemPattern: '//li[@class="guide-item"]',
		fields: {
			title: ".//p/text()",
			link: "substring-before(substring-after(.//a/@href, \"('\"), \"')\")",
			description: "concat('<img src=\"https://www.dapa.go.kr', substring-before(substring-after(div/@style, \"('\"), \"')\"), '\">')"
		}
	}),
	Sites.define({
		id: "dapa.go.kr_행정규칙",
		title: "방위사업청 행정규칙",
		link: "https://www.dapa.go.kr/dapa/rlm/rllawd/RlmNttList.do?menuId=340",
		itemPattern: '//table[@class="list-table"]/tbody/tr',
		fields: {
			title: "concat(td[6]/text(), ' ', normalize-space(td//a[@title]/text()))",
			link: "concat('https://www.dapa.go.kr/common/zipDownload.do?sqlId=cmm_file.fileList&fileGrpKey=', substring-before(substring-after(td//a[@title]/@onclick, \"'\"), \"'\"))",
			description: "concat(normalize-space(td[5]/text()), ' ', normalize-space(td[4]/text()))"
		}
	}),

	// 7. 국방과학연구소 (ADD)
	Sites.define({
		id: "add.re.kr_제안서 공모 안내",
		title: "국방과학연구소 제안서 공모 안내",
		link: "https://www.add.re.kr/kps/publicNtis/ntisList?menuId=MENU02201",
		itemPattern: "//table[@class='board']/tbody/tr",
		fields: {
			title: "td[2]/a/@title",
			link: "td[2]/a/@href",
			description: "concat(td[2]/a/@title, '<br>공고일: ', td[3]/text(), '<br>접수시작일: ', td[4]/text(), '<br>접수마감일: ', td[5]/text())"
		}
	}),
	Sites.define({
		id: "add.re.kr_제안서 공모 결과 안내",
		title: "국방과학연구소 제안서 공모 결과 안내",
		link: "https://www.add.re.kr/kps/publicNtis/ntisList?menuId=MENU02200",
		itemPattern: "//table[@class='board']/tbody/tr",
		fields: {
			title: "td[2]/a/@title",
			link: "td[2]/a/@href",
			description: "concat(td[2]/a/@title, '<br>공고일: ', td[3]/text(), '<br>접수시작일: ', td[4]/text(), '<br>접수마감일: ', td[5]/text())"
		}
	}),

	// 8. 기타 기술 블로그 및 보고서
	Sites.define({
		id: "makinarocks.ai_Blog",
		title: "MakinaRocks Blog",
		link: "https://www.makinarocks.ai/blog/",
		itemPattern: '//*[@class="post-item"]/a',
		fields: { title: "./h3/text()", link: "./@href" }
	}),
	Sites.define({
		id: "makinarocks.ai_Use Case",
		title: "MakinaRocks Use Case",
		link: "https://www.makinarocks.ai/use-cases/",
		itemPattern: '//*[@class="post-item"]/a',
		fields: { title: "./h3/text()", link: "./@href" }
	}),
	Sites.define({
		id: "etri.re.kr",
		title: "ETRI 단행본/발표자료",
		link: "https://ksp.etri.re.kr/ksp/plan-report/search",
		itemPattern: "//table/tbody/tr",
		fields: { title: "td[3]/a/strong/text()", link: "td[3]/a/@href", description: "concat('https://ksp.etri.re.kr', td[4]/a/@href)" }
	})
].forEach(site => {
	Sites.definitions[site.id || site.feedName] = site;
});

let test = function() {
    const siteId = "g-enews.com";

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
		//const http_data = JSON.stringify(http_data_obj);
		const result = FeedProcessor.buildFeed(siteId, http_data, "", params);
		console.log(result.isChanged);
		console.log(result.xml);
	}

	// 브라우저 Playground 테스트 러너
	if (typeof window !== "undefined" && !window.Tasker) {
		testWithMockData(siteId);
	}
}
