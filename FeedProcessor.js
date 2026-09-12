// ============================================================================
// [1] XML 관련 헬퍼 객체 (Xml)
// ============================================================================
const Xml = {
	escape: function (str) {
		return (str || "").replace(/[<>&'"]/g, function (c) {
			return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;' }[c];
		});
	},

	safeCdata: function (str) {
		return (str || "").replace(/]]>/g, "]]]]><![CDATA[>");
	},

	wrapCdata: function (str) {
		return "<![CDATA[" + this.safeCdata(str) + "]]>";
	},

	normalizeEntities: function (str) {
		if (!str) return "";
		var map = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
		return str.replace(/&(?:amp|lt|gt|quot|apos);/g, function (m) { return map[m] || m; }).trim();
	},

	getItems: function (xml) {
		if (!xml) return [];
		return xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
	},

	getItemKey: function (itemXml) {
		var match = itemXml.match(/<(?:guid|link)[^>]*>([\s\S]*?)<\/(?:guid|link)>/i);
		return match ? this.normalizeEntities(match[1].trim()) : "";
	},

	getSecondaryId: function (itemXml) {
		var key = this.getItemKey(itemXml);
		if (!key) return 0;
		var match = key.match(/[?&](?:id|no|seq|docSeq|article(?:No)?|idx|wr_id)=(\d+)/i)
				 || key.match(/\/(\d+)(?:\.[a-z]+)?(?:\?|$)/i);
		return match ? parseInt(match[1], 10) : 0;
	},

	// 불필요한 태그 정제 및 RSS 태그 정규화
	transformAndSanitizeTags: function (itemXml, stripHeavyTags) {
		var cleaned = itemXml;

		// atom:published -> pubDate 변환
		if (!/<pubDate\b[\s\S]*?<\/pubDate>/i.test(cleaned)) {
			cleaned = cleaned.replace(/<(?:atom:)?published\b[^>]*>/gi, "<pubDate>")
							 .replace(/<\/(?:atom:)?published>/gi, "</pubDate>");
		}

		// content:encoded -> description 변환
		if (/<content:encoded\b[\s\S]*?<\/content:encoded>/i.test(cleaned)) {
			cleaned = cleaned.replace(/<description\b[\s\S]*?<\/description>/gi, "");
			cleaned = cleaned.replace(/<content:encoded\b[^>]*>/gi, "<description>")
							 .replace(/<\/content:encoded>/gi, "</description>");
		}

		// 해외 접속 차단 및 대용량 방지를 위한 무거운 태그 제거 (img, iframe, script 등)
		if (stripHeavyTags) {
			cleaned = cleaned.replace(/<(?:script|style|iframe|video|audio|figure|picture)[^>]*>[\s\S]*?<\/(?:script|style|iframe|video|audio|figure|picture)>/gi, "");
			cleaned = cleaned.replace(/<img[^>]*>/gi, "");
		}

		return cleaned;
	}
};

// ============================================================================
// [2] 날짜 및 타임스탬프 헬퍼 객체 (DateUtil)
// ============================================================================
const DateUtil = {
	toRfc822: function (dateStr) {
		if (!dateStr) return new Date().toUTCString();
		var d = new Date(dateStr.includes("T") ? dateStr : dateStr.trim() + "T09:00:00Z");
		return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
	},

	getTimestamp: function (target) {
		var dateStr = "";
		if (typeof target === "string") {
			var match = target.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
			dateStr = match ? match[1].trim() : target;
		} else if (target && target.pubDate) {
			dateStr = target.pubDate;
		}
		var t = Date.parse(dateStr);
		return isNaN(t) ? 0 : t;
	}
};

// ============================================================================
// [3] 필드 파서 객체 (Parser)
// ============================================================================
const Parser = {
	getDotValue: function (obj, path) {
		try {
			return path.split('.').reduce(function (acc, part) { return acc[part]; }, obj) || "";
		} catch (e) {
			return "";
		}
	},

	extractFieldValue: function (node, pattern, dataType, docContext) {
		if (!pattern) return "";

		if (dataType === "json") {
			var cleanPattern = pattern.trim();
			if (cleanPattern.startsWith("`") && cleanPattern.endsWith("`")) {
				cleanPattern = cleanPattern.slice(1, -1);
			}
			if (cleanPattern.includes("${")) {
				var self = this;
				return cleanPattern.replace(/\$\{([^}]+)\}/g, function (_, path) {
					return self.getDotValue(node, path.trim());
				});
			}
			return this.getDotValue(node, cleanPattern);
		} else if (dataType === "xpath") {
			try {
				var doc = docContext || (node.ownerDocument || node);
				return doc.evaluate(pattern, node, null, XPathResult.STRING_TYPE, null).stringValue.trim();
			} catch (e) {
				return "";
			}
		} else if (dataType === "regex") {
			var m = node.match(new RegExp(pattern, "i"));
			return m ? (m[1] || "").trim() : "";
		}
		return "";
	}
};

// ============================================================================
// [4] 사이트 전용 헬퍼 객체 (DapaHelper)
// ============================================================================
const DapaHelper = {
	BOARD_CONFIG: {
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

	createConfig: function (bbsSeq) {
		var seq = String(bbsSeq || "443").trim();
		var board = this.BOARD_CONFIG[seq] || { menuSeq: "3031", title: "공지사항" };

		return {
			channelTitle: "방위사업청 " + board.title,
			channelLink: "https://www.dapa.go.kr/dapa/doc/selectDocList.do?menuSeq=" + board.menuSeq + "&bbsSeq=" + seq,
			dataType: "json",
			rootPath: "",
			fields: {
				title: "docTitle",
				link: "`https://www.dapa.go.kr/dapa/doc/selectDoc.do?docSeq=${docSeq}&menuSeq=" + board.menuSeq + "&bbsSeq=${bbsSeq}`",
				pubDate: "regDt",
				description: "docCn"
			},
			postProcess: function (items) {
				return items.map(function (item) {
					item.description = FeedProcessor.sanitizeHtml(item.description, /<\/p>\s*<br\/?>\s*<p\b/.test(item.description));
					return item;
				}).filter(function (item) { return item.title.length > 0; });
			},
			testCases: {
				testUrl: "https://www.dapa.go.kr/dapa/doc/selectDocListJson.do?bbsSeq=" + seq + "&menuSeq=" + board.menuSeq,
				method: "GET"
			}
		};
	}
};

// ============================================================================
// [5] 코어 피드 프로세서 (FeedProcessor)
// ============================================================================
const FeedProcessor = {
	Xml: Xml,
	DateUtil: DateUtil,
	Parser: Parser,
	DapaHelper: DapaHelper,

	// 사이트별 고정 설정 레지스트리
	configs: {
		"dapa_default": DapaHelper.createConfig("443")
	},

	// 동적 규칙 생성/가져오기
	getConfig: function (siteId, params) {
		if (siteId.indexOf("dapa_") === 0) {
			var bbsSeq = (params && params.bbsSeq) ? params.bbsSeq : siteId.replace("dapa_", "");
			return DapaHelper.createConfig(bbsSeq);
		}
		return this.configs[siteId] || null;
	},

	// HTML 공용 Sanitize
	sanitizeHtml: function (html, shouldConvertPToDiv) {
		return (html || "").replace(/<\/?([a-zA-Z0-9]+)(?:\s+[^>]*)?>/gi, function (match, tag) {
			tag = tag.toLowerCase();
			var isClosing = match.indexOf("</") === 0;
			if (tag === "a") {
				if (isClosing) return "</a>";
				var href = (match.match(/\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[1] || "#";
				return '<a href="' + href + '">';
			}
			if (shouldConvertPToDiv && tag === "p") return isClosing ? "</div>" : "<div>";
			if (tag === "span" || tag === "script" || tag === "style") return "";
			return match;
		}).trim();
	},

	resolveUrl: function (url, baseUrl) {
		return (url && !url.startsWith("http")) ? baseUrl.replace(/\/+$/, "") + "/" + url.replace(/^\/+/, "") : url;
	},

	// 1. 소스 데이터 파싱
	parseSource: function (config, rawData) {
		var items = [];
		if (!rawData) return items;

		if (config.dataType === "json") {
			var list = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
			if (config.rootPath) {
				config.rootPath.split(".").forEach(function (p) { if (list) list = list[p]; });
			}
			if (Array.isArray(list)) {
				for (var i = 0; i < list.length; i++) {
					var rawItem = list[i];
					items.push({
						title: Parser.extractFieldValue(rawItem, config.fields.title, "json"),
						link: this.resolveUrl(Parser.extractFieldValue(rawItem, config.fields.link, "json"), config.channelLink),
						pubDate: Parser.extractFieldValue(rawItem, config.fields.pubDate, "json"),
						description: Parser.extractFieldValue(rawItem, config.fields.description, "json")
					});
				}
			}
		} else if (config.dataType === "xpath") {
			var doc = new DOMParser().parseFromString(rawData, "text/html");
			var nodes = doc.evaluate(config.itemPattern, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
			for (var j = 0; j < nodes.snapshotLength; j++) {
				var node = nodes.snapshotItem(j);
				items.push({
					title: Parser.extractFieldValue(node, config.fields.title, "xpath", doc).replace(/<[^>]+>/g, ""),
					link: this.resolveUrl(Parser.extractFieldValue(node, config.fields.link, "xpath", doc), config.channelLink),
					pubDate: Parser.extractFieldValue(node, config.fields.pubDate, "xpath", doc).replace(/<[^>]+>/g, ""),
					description: Parser.extractFieldValue(node, config.fields.description, "xpath", doc)
				});
			}
		}
		return items;
	},

	// 2. 여러 피드 XML을 하나의 정규화된 최신 피드로 병합
	mergeMultipleFeeds: function (feedXmlArray, baseFeedXml, limit) {
		var maxLimit = limit || 10;
		var seenKeys = new Set();
		var mergedList = [];
		var self = this;

		// 모든 피드 배열 순회 및 아이템 추출
		(feedXmlArray || []).forEach(function (xml) {
			var rawItems = Xml.getItems(xml);
			rawItems.forEach(function (itemXml) {
				var transformed = Xml.transformAndSanitizeTags(itemXml, false);
				var key = Xml.getItemKey(transformed);
				if (key && !seenKeys.has(key)) {
					seenKeys.add(key);
					mergedList.push({
						isXml: true,
						xml: transformed,
						key: key,
						timestamp: DateUtil.getTimestamp(transformed),
						secondaryId: Xml.getSecondaryId(transformed)
					});
				}
			});
		});

		// 정렬 (날짜 1차 내림차순, ID 2차 내림차순)
		mergedList.sort(function (a, b) {
			var diff = b.timestamp - a.timestamp;
			if (diff !== 0) return diff;
			return b.secondaryId - a.secondaryId;
		});

		var topItems = mergedList.slice(0, maxLimit);
		var mergedBody = topItems.map(function (it) { return it.xml; }).join("\n");

		var base = baseFeedXml || (feedXmlArray && feedXmlArray.length ? feedXmlArray[0] : "");
		var cleanBase = (base || "").replace(/<item\b[\s\S]*?<\/item>/gi, "").replace(/(\r?\n\s*){2,}/g, "\n");

		if (/<\/channel>/i.test(cleanBase)) {
			return cleanBase.replace(/<\/channel>/i, mergedBody + "\n\t</channel>");
		}
		return cleanBase + "\n" + mergedBody;
	},

	// 3. 차단 방지 및 대용량 피드 경량화 최적화 로직
	optimizeFeed: function (sourceXml, oldRss, limit) {
		var maxLimit = limit || 10;
		if (!sourceXml) return { xml: oldRss || "", isChanged: false };

		var newRawItems = Xml.getItems(sourceXml);
		var oldRawItems = Xml.getItems(oldRss || "");

		var seenKeys = new Set();
		var mergedList = [];

		// 1) 신규 피드 아이템 정제 및 무거운 태그 제거
		newRawItems.forEach(function (itemXml) {
			var cleanedXml = Xml.transformAndSanitizeTags(itemXml, true);
			var key = Xml.getItemKey(cleanedXml);
			if (key && !seenKeys.has(key)) {
				seenKeys.add(key);
				mergedList.push({
					xml: cleanedXml,
					key: key,
					timestamp: DateUtil.getTimestamp(cleanedXml),
					secondaryId: Xml.getSecondaryId(cleanedXml)
				});
			}
		});

		// 2) 기존 피드 아이템 결합
		oldRawItems.forEach(function (itemXml) {
			var cleanedXml = Xml.transformAndSanitizeTags(itemXml, true);
			var key = Xml.getItemKey(cleanedXml);
			if (key && !seenKeys.has(key)) {
				seenKeys.add(key);
				mergedList.push({
					xml: cleanedXml,
					key: key,
					timestamp: DateUtil.getTimestamp(cleanedXml),
					secondaryId: Xml.getSecondaryId(cleanedXml)
				});
			}
		});

		// 정렬
		mergedList.sort(function (a, b) {
			var diff = b.timestamp - a.timestamp;
			if (diff !== 0) return diff;
			return b.secondaryId - a.secondaryId;
		});

		var topItems = mergedList.slice(0, maxLimit);
		var topXmlBody = topItems.map(function (it) { return it.xml; }).join("\n");

		// 변경 사항 검출 (상위 키 시퀀스 대조)
		var oldTopKeys = oldRawItems.slice(0, maxLimit).map(function (it) { return Xml.getItemKey(it); }).join("|");
		var newTopKeys = topItems.map(function (it) { return it.key; }).join("|");
		var isChanged = (oldTopKeys !== newTopKeys);

		var cleanBase = sourceXml.replace(/<item\b[\s\S]*?<\/item>/gi, "").replace(/(\r?\n\s*){2,}/g, "\n");
		var finalXml = "";

		if (/<\/channel>/i.test(cleanBase)) {
			finalXml = cleanBase.replace(/<\/channel>/i, topXmlBody + "\n\t</channel>");
		} else {
			finalXml = cleanBase + "\n" + topXmlBody;
		}

		return {
			xml: finalXml,
			isChanged: isChanged
		};
	},

	// 4. 단일 파이프라인 빌드 (새 데이터 + 기존 RSS)
	process: function (siteId, rawData, oldRss, params) {
		var config = this.getConfig(siteId, params);
		if (!config || !rawData) return { xml: oldRss || "", isChanged: false };

		var parsedItems = this.parseSource(config, rawData);
		if (config.postProcess) {
			parsedItems = config.postProcess(parsedItems);
		}

		var oldRawItems = Xml.getItems(oldRss || "");
		var seenKeys = new Set();
		var mergedList = [];
		var isChanged = false;

		// 신규 아이템 등록
		parsedItems.forEach(function (item) {
			var key = item.link;
			if (key && !seenKeys.has(key)) {
				seenKeys.add(key);
				mergedList.push({
					isRaw: true,
					item: item,
					key: key,
					timestamp: DateUtil.getTimestamp(item),
					secondaryId: Xml.getSecondaryId(item.link)
				});
			}
		});

		// 기존 아이템 등록
		oldRawItems.forEach(function (xmlBlock) {
			var key = Xml.getItemKey(xmlBlock);
			if (key && !seenKeys.has(key)) {
				seenKeys.add(key);
				mergedList.push({
					isRaw: false,
					xml: xmlBlock,
					key: key,
					timestamp: DateUtil.getTimestamp(xmlBlock),
					secondaryId: Xml.getSecondaryId(xmlBlock)
				});
			}
		});

		// 정렬
		mergedList.sort(function (a, b) {
			var diff = b.timestamp - a.timestamp;
			if (diff !== 0) return diff;
			return b.secondaryId - a.secondaryId;
		});

		var top10 = mergedList.slice(0, 10);
		var oldTopKeys = oldRawItems.slice(0, 10).map(function (it) { return Xml.getItemKey(it); }).join("|");
		var newTopKeys = top10.map(function (it) { return it.key; }).join("|");
		isChanged = (oldTopKeys !== newTopKeys);

		// XML 생성
		var xmlItems = top10.map(function (entry) {
			if (!entry.isRaw) return entry.xml;
			var it = entry.item;
			return "\t\t<item>\n" +
				   "\t\t\t<title>" + Xml.escape(it.title) + "</title>\n" +
				   "\t\t\t<link>" + Xml.escape(it.link) + "</link>\n" +
				   "\t\t\t<guid isPermaLink=\"true\">" + Xml.escape(it.link) + "</guid>\n" +
				   "\t\t\t<pubDate>" + DateUtil.toRfc822(it.pubDate) + "</pubDate>\n" +
				   "\t\t\t<description>" + Xml.wrapCdata(it.description) + "</description>\n" +
				   "\t\t</item>";
		}).join("\n");

		var finalXml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
			'<rss version="2.0">\n' +
			'\t<channel>\n' +
			'\t\t<title>' + Xml.escape(config.channelTitle) + '</title>\n' +
			'\t\t<link>' + Xml.escape(config.channelLink) + '</link>\n' +
			'\t\t<description>' + Xml.escape(config.channelTitle) + '</description>\n' +
			'\t\t<lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n' +
			xmlItems + '\n' +
			'\t</channel>\n' +
			'</rss>';

		return { xml: finalXml, isChanged: isChanged };
	}
};

// ============================================================================
// [6] 글로벌 실행 래퍼 (Tasker 및 외부 호출용)
// ============================================================================
function processFeed(siteId, rawData, oldRss, params) {
	return FeedProcessor.process(siteId, rawData, oldRss, params);
}

function optimizeFeed(sourceXml, oldRss, limit) {
	return FeedProcessor.optimizeFeed(sourceXml, oldRss, limit);
}

function mergeFeeds(feedXmlArray, baseFeedXml, limit) {
	return FeedProcessor.mergeMultipleFeeds(feedXmlArray, baseFeedXml, limit);
}

// Tasker JavaScriptlet 자동 실행 진입점
function runFeedProcessor(siteId) {
	var raw = typeof http_data !== "undefined" ? http_data : "";
	var oldXml = (typeof old_rss !== "undefined" && old_rss && old_rss !== "%old_rss") ? old_rss : "";
	var curBbsSeq = typeof bbs_seq !== "undefined" ? bbs_seq : "";

	var result = FeedProcessor.process(siteId, raw, oldXml, { bbsSeq: curBbsSeq });

	feed_changed = result.isChanged.toString();
	final_rss = result.xml;

	if (typeof setLocal === "function") {
		setLocal("%feed_changed", feed_changed);
		setLocal("%final_rss", final_rss);
	}
}

// ============================================================================
// [7] TS Playground / 브라우저 개발자 도구 테스트 환경
// ============================================================================
if (typeof http_data === "undefined" && typeof window !== "undefined" && !window.Tasker) {
	(function () {
		var TEST_BBS_SEQ = "443";
		var config = DapaHelper.createConfig(TEST_BBS_SEQ);
		var proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(config.testCases.testUrl);

		console.log("[FeedProcessor Test] Fetching DAPA Notice...");
		fetch(proxyUrl)
			.then(function (res) { return res.text(); })
			.then(function (data) {
				var res = processFeed("dapa_" + TEST_BBS_SEQ, data, "");
				console.log("Changed:", res.isChanged);
				console.log("Result XML:\n", res.xml);
			})
			.catch(console.error);
	})();
}
