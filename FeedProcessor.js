const Xml = {
	escape: str => (str || "").replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;' }[c])),
	safeCdata: str => (str || "").replace(/]]>/g, "]]]]><![CDATA[>"),
	wrapCdata: function (str) { return `<![CDATA[${this.safeCdata(str)}]]>`; },
	getItems: xml => (xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || [],

	getItemKey: function (itemXml) {
		const m = itemXml.match(/<(?:guid|link)[^>]*>([\s\S]*?)<\/(?:guid|link)>/i);
		if (!m) return "";
		const map = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
		return m[1].replace(/&(?:amp|lt|gt|quot|apos);/g, c => map[c] || c).trim();
	},

	getSecondaryId: function (itemXml) {
		const key = this.getItemKey(itemXml);
		const m = key.match(/[?&](?:id|no|seq|docSeq|article(?:No)?|idx|wr_id)=(\d+)/i) || key.match(/\/(\d+)(?:\.[a-z]+)?(?:\?|$)/i);
		return m ? parseInt(m[1], 10) : 0;
	},

	sanitizeTags: function (itemXml, stripHeavy = false) {
		let res = itemXml;
		if (!/<pubDate\b/i.test(res)) {
			res = res.replace(/<(?:atom:)?published\b[^>]*>/gi, "<pubDate>").replace(/<\/(?:atom:)?published>/gi, "</pubDate>");
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
	}
};

const DateUtil = {
	toRfc822: dateStr => {
		if (!dateStr) return new Date().toUTCString();
		const d = new Date(dateStr.includes("T") || dateStr.includes("+") ? dateStr : `${dateStr.trim()}T09:00:00Z`);
		return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
	},
	getTimestamp: target => {
		const str = typeof target === "string" ? (target.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] : target?.pubDate;
		const t = Date.parse((str || "").trim());
		return isNaN(t) ? 0 : t;
	}
};

const Parser = {
	getDotVal: (obj, path) => path.split('.').reduce((acc, part) => acc && acc[part], obj) || "",
	extract: function (node, pattern, type, docCtx) {
		if (!pattern) return "";
		if (type === "json") {
			const clean = pattern.replace(/^`|`$/g, "");
			return clean.includes("${") ? clean.replace(/\$\{([^}]+)\}/g, (_, p) => this.getDotVal(node, p.trim())) : this.getDotVal(node, clean);
		}
		if (type === "xpath") {
			try { return (docCtx || node.ownerDocument || node).evaluate(pattern, node, null, XPathResult.STRING_TYPE, null).stringValue.trim(); }
			catch (e) { return ""; }
		}
		if (type === "regex") {
			const m = node.match(new RegExp(pattern, "i"));
			return m ? (m[1] || "").trim() : "";
		}
		return "";
	}
};

const Sites = {
	// 1. 방위사업청 게시판 맵핑
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
		bbsSeq = String(bbsSeq).trim();
		const b = this.dapaBoards[bbsSeq];
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
					it.description = FeedProcessor.cleanHtml(it.description, /<\/p>\s*<br\/?>\s*<p\b/.test(it.description));
					return it;
				})
				.filter(it => it.title.length > 0),
			testCases: {
				url: `https://www.dapa.go.kr/dapa_news/portlet/docList.do?bbsSeq=${bbsSeq}&rownum=10`,
				method: "GET"
			}
		};
	},

	// 2. 등록된 개별 사이트 정의 (정적/독립 사이트)
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
			excludeCategories: new Set(["게임", "경제","금융", "증권"]),
			postProcess: function (items) {
				return items
					.filter(it => !this.excludeCategories.has(it?._raw.category_name?.trim() || ""))
					.map(it => {
						const raw = it._raw || {};

						// A. 작성자 파싱
						try {
							const bylines = typeof raw.by_line_list === "string" ? JSON.parse(raw.by_line_list) : raw.by_line_list;
							if (Array.isArray(bylines)) it.author = bylines.map(v => v.ca_writer_byline).filter(Boolean).join(", ");
						} catch (e) {}

						// B. 카테고리 매핑
						it.category = raw.category_name || "";

						// C. 대표 이미지 및 figure 조립
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
						} catch (e) {}

						// D. 본문 개행 및 결합
						const body = (raw.body_text || "").trim().replace(/\n/g, "<br/>");
						it.description = figureHtml ? `${figureHtml}<br/>\n${body}` : body;

						// E. 타임존 보정 (+09:00)
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

	// 3. 사이트 ID 해석기
	resolve: function (siteId, params) {
		if (!siteId) return null;
		if (siteId.startsWith("dapa")) {
			const seq = params?.bbsSeq || siteId.replace(/^dapa_?/, "");
			return this.createDapaConfig(seq);
		}
		return this.definitions[siteId] || null;
	}
};

const FeedProcessor = {
	cleanHtml: (html, pToDiv = false) => (html || "").replace(/<\/?([a-zA-Z0-9]+)(?:\s+[^>]*)?>/gi, (m, tag) => {
		tag = tag.toLowerCase();
		const closing = m.startsWith("</");
		if (tag === "a") return closing ? "</a>" : `<a href="${(m.match(/\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[1] || "#"}">`;
		if (pToDiv && tag === "p") return closing ? "</div>" : "<div>";
		return (tag === "span" || tag === "script" || tag === "style") ? "" : m;
	}).trim(),

	resolveUrl: (url, base) => (url && !url.startsWith("http")) ? `${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}` : url,

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

	getFeedName: function (siteId, params) {
		const config = Sites.resolve(siteId, params);
		return config?.feedName || siteId;
	},

	// 1. 소스 데이터 파싱 (원본 _raw 유지)
	parse: function (config, rawData) {
		if (!rawData) return [];
		let items = [];

		if (config.dataType === "json") {
			let list = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
			if (config.rootPath) config.rootPath.split(".").forEach(p => list = list?.[p]);
			if (Array.isArray(list)) {
				items = list.map(it => ({
					title: Parser.extract(it, config.fields.title, "json"),
					link: this.resolveUrl(Parser.extract(it, config.fields.link, "json"), config.channelLink),
					pubDate: Parser.extract(it, config.fields.pubDate, "json"),
					description: Parser.extract(it, config.fields.description, "json"),
					author: Parser.extract(it, config.fields.author, "json"),
					category: Parser.extract(it, config.fields.category, "json"),
					_raw: it
				}));
			}
		} 
		else if (config.dataType === "xpath") {
			const doc = new DOMParser().parseFromString(rawData, "text/html");
			const nodes = doc.evaluate(config.itemPattern, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
			for (let i = 0; i < nodes.snapshotLength; i++) {
				const node = nodes.snapshotItem(i);
				items.push({
					title: Parser.extract(node, config.fields.title, "xpath", doc).replace(/<[^>]+>/g, ""),
					link: this.resolveUrl(Parser.extract(node, config.fields.link, "xpath", doc), config.channelLink),
					pubDate: Parser.extract(node, config.fields.pubDate, "xpath", doc).replace(/<[^>]+>/g, ""),
					description: Parser.extract(node, config.fields.description, "xpath", doc),
					author: Parser.extract(node, config.fields.author, "xpath", doc),
					category: Parser.extract(node, config.fields.category, "xpath", doc),
					_raw: node
				});
			}
		}
		else if (config.dataType === "regex") {
			const blockRegex = new RegExp(config.itemPattern, "gi");
			const matches = rawData.match(blockRegex) || [];

			items = matches.map(block => ({
				title: Parser.extract(block, config.fields.title, "regex").replace(/<[^>]+>/g, "").trim(),
				link: this.resolveUrl(Parser.extract(block, config.fields.link, "regex"), config.channelLink),
				pubDate: Parser.extract(block, config.fields.pubDate, "regex").replace(/<[^>]+>/g, "").trim(),
				description: Parser.extract(block, config.fields.description, "regex"),
				author: Parser.extract(block, config.fields.author, "regex").replace(/<[^>]+>/g, "").trim(),
				category: Parser.extract(block, config.fields.category, "regex").replace(/<[^>]+>/g, "").trim(),
				_raw: block
			}));
		}

		return items;
	},

	// 2. 단일 피드 생성 (신규 데이터 + 이전 피드)
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
				mergedList.push({ isRaw: false, xml: xml, key: key, timestamp: DateUtil.getTimestamp(xml), secondaryId: Xml.getSecondaryId(xml) });
			}
		});

		const top10 = this.sortDesc(mergedList).slice(0, 10);
		const isChanged = oldRawItems.slice(0, 10).map(Xml.getItemKey).join("|") !== top10.map(it => it.key).join("|");

		const xmlItems = top10.map(entry => {
			if (!entry.isRaw) return entry.xml;
			const it = entry.item;
			const authorTag = it.author ? `\n\t\t\t<author>${Xml.escape(it.author)}</author>` : "";
			const categoryTag = it.category ? `\n\t\t\t<category>${Xml.escape(it.category)}</category>` : "";

			return `\t\t<item>\n\t\t\t<title>${Xml.escape(it.title)}</title>\n\t\t\t<link>${Xml.escape(it.link)}</link>\n\t\t\t<guid isPermaLink="true">${Xml.escape(it.link)}</guid>${authorTag}${categoryTag}\n\t\t\t<pubDate>${DateUtil.toRfc822(it.pubDate)}</pubDate>\n\t\t\t<description>${Xml.wrapCdata(it.description)}</description>\n\t\t</item>`;
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

		const topItemsXml = this.sortDesc(mergedList).slice(0, limit).map(it => it.xml).join("\n");
		const base = (baseXml || feedXmlList?.[0] || "").replace(/<item\b[\s\S]*?<\/item>/gi, "").replace(/(\r?\n\s*){2,}/g, "\n");
		return /<\/channel>/i.test(base) ? base.replace(/<\/channel>/i, `${topItemsXml}\n\t</channel>`) : `${base}\n${topItemsXml}`;
	},

	// 4. 대용량/해외 차단 피드 경량화 최적화
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
				mergedList.push({ xml: cleaned, key: key, timestamp: DateUtil.getTimestamp(cleaned), secondaryId: Xml.getSecondaryId(cleaned) });
			}
		});

		const topItems = this.sortDesc(mergedList).slice(0, limit);
		const isChanged = oldRaw.slice(0, limit).map(Xml.getItemKey).join("|") !== topItems.map(it => it.key).join("|");

		const cleanBase = newXml.replace(/<item\b[\s\S]*?<\/item>/gi, "").replace(/(\r?\n\s*){2,}/g, "\n");
		const bodyXml = topItems.map(it => it.xml).join("\n");
		const finalXml = /<\/channel>/i.test(cleanBase) ? cleanBase.replace(/<\/channel>/i, `${bodyXml}\n\t</channel>`) : `${cleanBase}\n${bodyXml}`;

		return { xml: finalXml, isChanged };
	}
};

const buildFeed = (siteId, raw, old, params) => FeedProcessor.buildFeed(siteId, raw, old, params);
const mergeFeeds = (list, base, limit) => FeedProcessor.mergeFeeds(list, base, limit);
const optimizeFeed = (src, old, limit) => FeedProcessor.optimizeFeed(src, old, limit);

function testWithFetch(siteId) {
	const conf = Sites.resolve(siteId);
	fetch(`https://corsproxy.io/?${encodeURIComponent(conf.testCases.url)}`)
		.then(r => r.text())
		.then(data => console.log("Result XML:\n", buildFeed("dapa_443", data, "").xml))
		.catch(console.error);
}

let main = function() {
	// 브라우저 Playground 테스트 러너
	if (typeof window !== "undefined" && !window.Tasker) {
		const siteId = "ddaily";
		console.clear();
		const feedName = FeedProcessor.getFeedName(siteId);
		console.log(feedName);
		const http_data = JSON.stringify(http_data_obj);
		const result = FeedProcessor.buildFeed(siteId, http_data, "", {});
		console.log(result.isChanged);
		console.log(result.xml);
	}
}
