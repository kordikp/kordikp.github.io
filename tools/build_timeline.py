#!/usr/bin/env python3
"""Build data/timeline.json for timeline.html.

Sources (kept outside this public repo):
  --v3s       V3S export (xlsx) with publications 2007-2026
  --kos       KOS export of supervised theses (CSV: typ,role,stav,rok_odevzdani,student,nazev,nazev_en)
  --openalex  OpenAlex works of the author (JSON list), used for papers missing in V3S
  --handles   thesis_handles.csv in this repo (DSpace handles)

Curated content (milestones, eras, extra papers, theme overrides) lives in this file.
Only defended theses where Pavel Kordík was the supervisor are published.

    TIMELINE_V3S=/path/v3s.xlsx TIMELINE_KOS=/path/kos.csv python3 -I tools/build_timeline.py --openalex /path/oa_all.json
"""
import argparse
import csv
import json
import os
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# List order = stacking order of the chart (bottom first) = categorical colour slot order.
THEMES = [
    {"id": "recsys", "short": "Recommender systems", "label": "Recommender systems & search",
     "text": "How to pick the right item for the right person: scalable autoencoders, cold start, honest "
             "evaluation and search. Most of it runs in production at Recombee."},
    {"id": "language", "short": "Language, agents & safety", "label": "Language models, agents & AI safety",
     "text": "Text, explanations and AI agents: what language models know, how agents divide work in "
             "marketplaces, and how to keep chatbots safe, also for children."},
    {"id": "science", "short": "Science & climate", "label": "AI for science, health & climate",
     "text": "Machine learning on real measurements: weather nowcasting, climate and rural data, fluid "
             "simulations, medicine and forensic anthropology."},
    {"id": "society", "short": "Education & society", "label": "Education, society & applied AI",
     "text": "AI for learning and for the people around it: education data, startups, skills and "
             "academia-industry matching."},
    {"id": "neural", "short": "Neural nets & optimization", "label": "Neural networks & optimization",
     "text": "Neural networks, evolutionary algorithms and learned optimizers; from neuroevolution to "
             "transformers."},
    {"id": "mining", "short": "Data mining", "label": "Data mining, clustering & visualization",
     "text": "Finding structure in data: clustering (Chameleon), anomalies, time series and interactive "
             "visualization."},
    {"id": "automl", "short": "AutoML & meta-learning", "label": "Inductive modelling, meta-learning & AutoML",
     "text": "Letting algorithms build models: the GAME method, meta-learning templates, Predictor Factory "
             "and automated data mining."},
]

# Order matters: the first matching rule wins.
RULES = [
    ("recsys", r"recommend|cold.?start|collaborative filter|serendipit|next.?basket|shopping basket|"
               r"personali[sz]|retrieval|semantic (product )?search|search engine|learning to rank|repsys|"
               r"recall.?coverage|shallow autoencoder|autoencoders? in recommender|nearest neighbou?r|"
               r"subaccount|related images|music|e-?shop|movies to obtain|customer lifetime|"
               r"user clusters|recommended content|editorial|email outreach|doporu"),
    ("language", r"language model|\bllm|agentic|ai agents?\b|natural language|nlp|text|document|question answering|chatbot|"
                 r"dialog|conversation|query|semantic network|latent topic|safety|guardrail|alignment|"
                 r"harmful|explanation|lip reading|speech|sentiment|translation|typo|spam|jazyk"),
    ("science", r"climate|weather|nowcast|radar|precipitation|cfd|multiphase|closure model|forensic|"
                r"age.at.death|pelvic|pubic|skeletal|sleep|eeg|electrogram|atrial|fetal|medical|clinic|"
                r"health|dyslexia|eye movement|vestibular|geophysic|agricultur|crop|rural|spatial|"
                r"energy|household|chemometr|gc-ms|physics|mobility|landmark|satellite|prague surface|"
                r"flight|criminal|border|traffic|vehicle routing|photovolta|borreli|metallurg|biological signal|"
                r"anthropolog|noise cancel"),
    ("society", r"educat|student|school|children|kids|curricul|teaching|learning analytics|"
                r"knowledge tracing|startup|start-up|university|dashboard|skills|"
                r"opportunit|industry|widget|partnership"),
    ("automl", r"inductive|gmdh|\bgame\b|polynomial|meta.?learn|ensemble|automl|automated data mining|"
               r"predictor factory|relational|propositional|feature (selection|ranking)|transfer learning|"
               r"model selection|templates|self.organi[sz]|predictive model|preprocessing|imputation|"
               r"cross.validation|friedman|stream of features|aggregate function|foreign key|"
               r"knowledge flow|pmml"),
    ("mining", r"cluster|chameleon|visuali[sz]|data mining|anomal|exploratory|interactive evolution|"
               r"time series|outlier|dimensionality|analytics|mining"),
    ("neural", r"neural|deep|network|optimi[sz]|evolution|genetic|ant system|ant algorithm|swarm|"
               r"reinforcement|neat|neuroevolution|transformer|turing machine|few.shot|learned optimi|"
               r"gradient|mode decomposition|auto.sizing|weight initiali|backpropagation|benchmark"),
]

# Theme overrides keyed by a lowercase title fragment (papers and theses).
OVERRIDES = {
    "maintaining diversity in population": ["automl"],
    "division of labour in strategic": ["language", "recsys"],
    "hybrid inductive models": ["automl"],
    "evolutionary search for interesting behavior": ["automl", "neural"],
    "meta-learning approach to neural network optimization": ["automl", "neural"],
    "discovering predictive ensembles": ["automl"],
    "neural turing machine for sequential learning of human mobility": ["neural", "science"],
    "reducing cold start problems in educational recommender": ["recsys", "society"],
    "personalised recommendations and profile based re-ranking": ["recsys", "society"],
    "personalized recommendations for students": ["recsys", "society"],
    "mining skills from educational data": ["recsys", "society"],
    "utilizing educational data": ["society"],
    "how would you like your recommendations": ["recsys", "society"],
    "mitigating risks in marketplace semantic search": ["recsys", "language"],
    "language embeddings meet shallow autoencoders": ["recsys", "language"],
    "beeformer": ["recsys", "language"],
    "no safe words": ["language", "science"],
    "bridging global language models and local spatial data": ["language", "science"],
    "closure model selection": ["science", "recsys"],
    "downscaling climate projections": ["science", "neural"],
    "learning to optimize with dynamic mode decomposition": ["neural"],
    "enhancing fractional gradient descent": ["neural"],
    "transfer learning based few-shot classification": ["neural", "automl"],
    "selecting representative data sets": ["mining"],
    "age at death assessment": ["science", "automl"],
    "fully automated knowledge extraction": ["automl"],
    "fast and exact audit scheduling": ["mining"],
    "the 19th acm conference on recommender systems": ["recsys"],
    "a guide to building a technological startup": ["society"],
    "reasoning-grounded natural language explanations": ["language"],
    "segment-aware analytics": ["recsys"],
    # theses
    "machine learning in game playing": ["neural"],
    "self organizing map and its extensions": ["neural"],
    "training set construction": ["automl", "mining"],
    "noisy data modeling": ["automl"],
    "automated knowledge extraction": ["automl"],
    "matafeature database": ["automl"],
    "statistical data processing module": ["mining"],
    "pattern recognition for real world data": ["mining"],
    "alternation of meta-heuristic": ["neural"],
    "visual search in big graph": ["mining"],
    "time-space behaviour analysis": ["mining", "science"],
    "large language model assisted symbolic regression": ["language", "automl"],
    "customer lifetime value": ["mining"],
}

# Papers not in V3S (before 2007, or 2026 and later). V3S + OpenAlex cover the rest.
EXTRA_PAPERS = [
    # Early papers listed on Google Scholar but missing in V3S and OpenAlex
    {"y": 2002, "sub": "conference", "title": "The modified GMDH method applied to model complex systems",
     "authors": "Kordík P., Náplava P., Šnorek M., Genyk-Berezovskyj M.",
     "venue": "International Conference on Inductive Modelling (ICIM 2002)"},
    {"y": 2003, "sub": "journal", "title": "Modified GMDH method and models quality evaluation by visualization",
     "authors": "Kordík P., Náplava P., Šnorek M., Genyk-Berezovskyj M.",
     "venue": "Control Systems and Computers 2, pp. 68–75"},
    {"y": 2005, "sub": "conference", "title": "Dyslexia detection from eye movements using artificial neural networks",
     "authors": "Macaš M., Novák D., Kordík P., Lhotská L., Vyhnálek M., Brzezný R.",
     "venue": "European Medical and Biological Engineering Conference (EMBEC 2005)"},
    {"y": 2006, "sub": "conference", "title": "Maintaining Diversity in Population of Evolved Models",
     "authors": "Drchal J., Šnorek M., Kordík P.", "venue": "40th Spring International Conference MOSIS 2006, pp. 113–120"},
    {"y": 2009, "sub": "workshop", "title": "Methods of true data mining model selection with experimental results",
     "authors": "Bulgakova O., Kordík P.", "venue": "3rd International Workshop on Inductive Modelling (IWIM 2009)"},
    {"y": 2004, "sub": "conference", "title": "School children dyslexia analysis using self organizing maps",
     "authors": "Kordík P., Šnorek M. et al.", "venue": "26th Annual Int. Conference of the IEEE EMBS (2004)",
     "doi": "10.1109/IEMBS.2004.1403075"},
    {"y": 2005, "sub": "conference", "title": "Ensemble Techniques for Credibility Estimation of GAME Models",
     "authors": "Kordík P., Šnorek M.", "venue": "ICANN 2005, LNCS 3697", "doi": "10.1007/11550907_21"},
    {"y": 2007, "sub": "thesis", "title": "Fully Automated Knowledge Extraction using Group of Adaptive Models Evolution",
     "authors": "Kordík P.", "venue": "Ph.D. thesis, Czech Technical University in Prague (supervisor M. Šnorek)"},
    {"y": 2026, "sub": "conference",
     "title": "How Would You Like Your Recommendations? p-book, a Self-Recommending Living Book That Teaches How Recommender Systems Work",
     "authors": "Kordík P., Nečasová E.", "venue": "RecSys 2026 (20th ACM Conference on Recommender Systems), demo",
     "doi": "10.1145/3773078.3841269", "url": "https://recsys-pbook.vercel.app"},
    {"y": 2026, "sub": "conference", "title": "Language Embeddings Meet Shallow Autoencoders",
     "authors": "Alves R., Vančura V., Kordík P., Ledent A.",
     "venue": "UMAP 2026 (34th ACM Conference on User Modeling, Adaptation and Personalization)",
     "doi": "10.1145/3774935.3806192"},
    {"y": 2026, "sub": "workshop",
     "title": "No Safe Words: Building Shortcut-Resistant Safety Guardrails for Geographically Grounded Environmental Advice",
     "authors": "Perles M., Slyvka O., Kordík P.",
     "venue": "GeoAI '26, 9th ACM SIGSPATIAL Int. Workshop on AI for Geographic Knowledge Discovery",
     "url": "https://doi.org/10.5281/zenodo.22050643"},
    {"y": 2026, "sub": "conference",
     "title": "Evaluating the Division of Labour in Strategic Two-Sided Agentic Marketplaces",
     "authors": "Matušek J., Kordík P.",
     "venue": "IJCCI 2026, special session AI Agents: Progress, Architecture, and Applications (AIPAA), accepted"},
    {"y": 2026, "sub": "workshop",
     "title": "Mind the Alignment Gap: Why General-Purpose Moderation Fails Children, and How a Child-Centric "
              "Taxonomy and Synthetic Data Close It",
     "authors": "Fikeis J., Kordík P.",
     "venue": "WOAH 2026, 10th Workshop on Online Abuse and Harms @ EMNLP 2026, accepted"},
    {"y": 2026, "sub": "preprint",
     "title": "Hybrid Cold-Start Recommender System for Closure Model Selection in Multiphase Flow Simulations",
     "authors": "Hänsch S., Sajdoková A., Rębowski A., Miškařík F., Ramakrishna K., Schlegel F., Rybář V., Alves R., Kordík P.",
     "venue": "arXiv:2604.09112", "url": "https://arxiv.org/abs/2604.09112"},
    {"y": 2004, "sub": "conference", "title": "Hybrid inductive models: deterministic crowding employed",
     "authors": "Kordík P., Šnorek M., Genyk-Berezovskyj M.", "venue": "IJCNN 2004 (IEEE Int. Joint Conference on Neural Networks)",
     "doi": "10.1109/IJCNN.2004.1380992"},
    {"y": 2006, "sub": "conference", "title": "Evolutionary Search for Interesting Behavior of Neural Network Ensembles",
     "authors": "Kordík P., Saidl J., Šnorek M.", "venue": "IJCNN 2006", "doi": "10.1109/IJCNN.2006.1716252"},
    {"y": 2011, "sub": "journal", "title": "Active subsurface structures at Fayoum-Cairo district, Northern Western Desert, Egypt",
     "authors": "Brimich L., Khalil A., Kordík P., Mekkawi M. et al.", "venue": "Contributions to Geophysics and Geodesy"},
    {"y": 2021, "sub": "journal", "title": "Fast and exact audit scheduling optimization",
     "authors": "Motl J., Kordík P.", "venue": "SN Applied Sciences 3(10), 794", "doi": "10.1007/s42452-021-04778-z"},
    {"y": 2021, "sub": "preprint", "title": "SimpleTRON: Simple Transformer with O(N) Complexity",
     "authors": "Yorsh U., Kovalenko A., Vančura V., Vašata D., Kordík P., Mikolov T.", "venue": "arXiv:2111.15588",
     "doi": "10.48550/arXiv.2111.15588"},
    {"y": 2023, "sub": "conference", "title": "Decorelated Weight Initialization by Backpropagation",
     "authors": "Kovalenko A., Kordík P.", "venue": "ICANN 2023, LNCS", "doi": "10.1007/978-3-031-44207-0_46"},
    {"y": 2025, "sub": "conference",
     "title": "Mitigating Risks in Marketplace Semantic Search: A Dataset for Harmful and Sensitive Query Alignment",
     "authors": "Spáček F., Vančura V., Kordík P.", "venue": "UMAP 2025 (33rd ACM Conference on User Modeling, Adaptation and Personalization)",
     "doi": "10.1145/3699682.3728329"},
    {"y": 2025, "sub": "conference",
     "title": "Bridging Global Language Models and Local Spatial Data: The JackDaw Approach to Context-Aware Agriculture and Rural Planning",
     "authors": "Charvát K., Bergheim R., Palma R., Rynkiewicz A. A., Botek M., Kovalenko A., Kordík P., Horáková Š., Kollerová M.",
     "venue": "FedCSIS 2025, Annals of Computer Science and Information Systems 43, pp. 507–518", "doi": "10.15439/2025F8393"},
    {"y": 2025, "sub": "journal", "title": "Data-driven closure model selection for multiphase CFD via matrix completion",
     "authors": "Hänsch S., Sajdoková A., Rabau A., Rybář V., Alves R., Kordík P.", "venue": "AI Thermal Fluids 4, 100019",
     "doi": "10.1016/j.aitf.2025.100019"},
    {"y": 2025, "sub": "preprint", "title": "Enhancing Fractional Gradient Descent with Learned Optimizers",
     "authors": "Sobotka J., Šimánek P., Kordík P.", "venue": "arXiv:2510.18783", "doi": "10.48550/arXiv.2510.18783"},
    {"y": 2025, "sub": "workshop", "title": "Downscaling climate projections to 1 km with single-image super resolution",
     "authors": "Košťál P., Kordík P., Podsztavek O.", "venue": "NeurIPS 2025 Workshop on Tackling Climate Change with Machine Learning",
     "url": "https://www.climatechange.ai/papers/neurips2025/86"},
    {"y": 2026, "sub": "article", "title": "The 19th ACM Conference on Recommender Systems (RecSys 2025)",
     "authors": "Kordík P., Schedl M., Bieliková M., Pera M. S., De Gemmis M.",
     "venue": "ACM SIGWEB Newsletter, Summer 2026", "doi": "10.1145/3830455.3830456"},
]

# V3S entries that are not research papers on their own (or are duplicates).
SKIP_PAPERS = ["chemometrické zpracování", "prediktivní behaviorální analýza", "analýza faktorů poukazujících",
               "convergence of algorihms for ann", "proceedings of the 3rd international workshop on inductive",
               "lecture 5: data reduction", "pureformer", "simpletron: eliminating softmax"]

YEAR_FIX = {"reasoninggroundednaturallangua": 2025}  # xAI 2025 proceedings appeared in 2026
AUTHOR_FIX = {"Da Silva Alves R.": "Alves R.", "Kuzněcov S.": "Kuznetsov S.", "Kader AKAK": "Abdel Kader A. K."}

# Better venue labels for selected items.
VENUE_FIX = {
    "bridging global language models": "FedCSIS 2025, Annals of Computer Science and Information Systems 43, pp. 507–518",
    "segment-aware analytics": "INRA 2025 workshop @ RecSys 2025 (CEUR-WS Vol-4056)",
    "reasoning-grounded natural language explanations": "xAI 2025 (World Conference on Explainable AI), CCIS 2578, pp. 3–18",
}

PHD = [  # co-supervised doctoral theses (V3S 3.7, titles from DSpace); KOS lists only own students
    {"y": 2016, "student": "Aleš Pilný", "title": "Model Machine Learning-based Feature Ranking and Feature Selection",
     "role": "co-supervisor", "themes": ["automl"], "url": "https://dspace.cvut.cz/handle/10467/61362"},
    {"y": 2016, "student": "Ondřej Háva", "title": "Network Representation of Latent Features Extracted from Text Documents",
     "role": "co-supervisor", "themes": ["language", "mining"], "url": "https://dspace.cvut.cz/handle/10467/62282"},
]

MILESTONES = [
    (2003, "academic", "Ing. in Computer Engineering, CTU FEE",
     "Graduated from the Faculty of Electrical Engineering, Czech Technical University in Prague."),
    (2004, "academic", "Joined the Department of Computer Science, CTU FEE",
     "Started teaching and research in the computational intelligence group of prof. Miroslav Šnorek."),
    (2007, "academic", "Ph.D. on automated knowledge extraction",
     "Dissertation on the GAME method (Group of Adaptive Models Evolution); organised the IWIM 2007 workshop in Prague."),
    (2007, "academic", "New course: Data Mining (FEE)",
     "Introduced the data mining course at CTU FEE together with Filip Železný."),
    (2008, "community", "ICANN 2008 in Prague",
     "Organising committee of the 18th International Conference on Artificial Neural Networks."),
    (2009, "academic", "Moved to the new Faculty of Information Technology",
     "Founding years of FIT CTU; released the open-source FAKE GAME system for automated data mining."),
    (2010, "academic", "Vice-Dean for Development, FIT CTU (2010–2016)",
     "Built up the young faculty; introduced master's courses Data Preprocessing, Data Mining Algorithms and Computational Intelligence Methods."),
    (2011, "community", "Program committee, ACM KDD 2011", ""),
    (2015, "industry", "Co-founded Recombee",
     "Recommender systems as a service, now with customers worldwide; it works closely with the group at CTU."),
    (2015, "community", "ECOOP 2015 in Prague", "Organising committee of the European Conference on Object-Oriented Programming."),
    (2017, "academic", "Associate Professor (doc.) in Informatics", "Habilitation at FIT CTU."),
    (2017, "academic", "Vice-Dean for Industry Cooperation, FIT CTU (2017–2024)",
     "Ran the faculty's partnership programme with companies."),
    (2017, "industry", "Co-founded experts.ai", "A platform connecting university experts with industry."),
    (2019, "nonprofit", "Co-founded prg.ai", "Prague AI hub of the city, Charles University, the Czech Academy of Sciences and CTU."),
    (2019, "academic", "First doctoral students defended", "Tomáš Řehořek (now leading Recombee) and Tomáš Bartoň."),
    (2020, "community", "UniHack 2020",
     "Co-organised an online hackathon of FIT CTU and prg.ai: in the first COVID spring, student teams and mentors looked for ways to help companies, the city, schools and healthcare."),
    (2021, "nonprofit", "Co-founded AI dětem", "Teaching artificial intelligence to children at Czech schools."),
    (2021, "award", "2nd place, Meta-Learning Challenge (AAAI 2021)", "T. Chobola, D. Vašata, P. Kordík."),
    (2022, "award", "1st place, Weather4cast 2022 (NeurIPS 2022)",
     "Core challenge won by the group (J. Pihrt, R. Raevskiy, P. Šimánek, M. Choma), in collaboration with Meteopress."),
    (2023, "award", "Best Paper Award, EvalRS @ KDD 2023", "P. Kasalický, R. Alves, P. Kordík."),
    (2024, "project", "Three EU projects start",
     "PoliRuralPlus (Horizon Europe, CTU coordinates 20 partners), capTTict (Interreg Danube, CTU lead partner) and FOCAL (Horizon Europe)."),
    (2024, "industry", "Co-founded edumatch.ai", "Matching students with real-world opportunities in companies."),
    (2024, "community", "ACM RecSys Steering Committee", "Also Senior PC member of RecSys 2024."),
    (2025, "community", "General Co-Chair, ACM RecSys 2025 in Prague", "More than 1,000 attendees from around the world."),
    (2026, "project", "capTTict completed", "Technology transfer and startup support across 9 Danube countries (2024–2026)."),
    (2026, "project", "p-book and RecSys Atlas", "A self-recommending living book (RecSys 2026 demo) and a map of 20 years of RecSys research."),
]

ERAS = [
    {"from": 2002, "to": 2008, "title": "Inductive modelling",
     "text": "Student and Ph.D. years with prof. Miroslav Šnorek, starting from the GMDH method. The GAME method grows networks of heterogeneous neurons "
             "from data; ensembles of such models estimate their own credibility. First applications in "
             "medicine: sleep stages, atrial electrograms, fetal weight."},
    {"from": 2009, "to": 2014, "title": "Meta-learning and data mining",
     "text": "At the new FIT CTU: meta-learning templates that combine models, the FAKE GAME open-source system, "
             "continuous optimization libraries, feature ranking, clustering and text mining. "
             "Most theses of this era build predictive models for real data."},
    {"from": 2015, "to": 2019, "title": "From AutoML to recommender systems",
     "text": "Recombee is founded and the group turns to recommendation. In parallel: learning from relational "
             "data (Predictor Factory), multi-objective clustering (Chameleon 2) and predictive ensembles for "
             "transfer learning. The first doctoral students defend."},
    {"from": 2020, "to": 2023, "title": "Deep learning in practice",
     "text": "Scalable shallow autoencoders (ELSA, VASP) and honest offline evaluation of recommenders; "
             "learned optimizers and physics-informed weather nowcasting with Meteopress; awards at NeurIPS, "
             "KDD and AAAI workshops."},
    {"from": 2024, "to": 2026, "title": "Recommendation meets language models",
     "text": "Language and interaction signals merge (beeFormer, sparse embeddings), LLMs get explained and "
             "guarded (SHIELD, child-safety alignment, geo-grounded guardrails), AI agents start shopping on "
             "both sides of a marketplace, EU projects bring climate "
             "and rural data. RecSys 2025 comes to Prague; the p-book and RecSys Atlas open the field to "
             "newcomers."},
]


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def classify(title, extra=""):
    t = (title or "").lower()
    for frag, th in OVERRIDES.items():
        if frag in t:
            return th
    text = t + " " + (extra or "").lower()
    found = [tid for tid, rx in RULES if re.search(rx, text)]
    return found[:2] if found else ["society"]


# ---------- V3S ----------
def read_xlsx(path):
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    tag = "{%s}" % ns["m"]
    z = zipfile.ZipFile(path)
    ss = ["".join(t.text or "" for t in si.iter(tag + "t"))
          for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns)]

    def col(ref):
        n = 0
        for ch in re.match(r"[A-Z]+", ref).group():
            n = n * 26 + ord(ch) - 64
        return n - 1

    rows = []
    for name in ("xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"):
        for row in ET.fromstring(z.read(name)).iter(tag + "row"):
            vals = {}
            for c in row.findall("m:c", ns):
                v = c.find("m:v", ns)
                if c.get("t") == "s" and v is not None:
                    vals[col(c.get("r"))] = ss[int(v.text)]
                elif c.get("t") == "inlineStr":
                    vals[col(c.get("r"))] = "".join(x.text or "" for x in c.iter(tag + "t"))
                else:
                    vals[col(c.get("r"))] = v.text if v is not None else ""
            if vals:
                rows.append([vals.get(k, "") for k in range(max(vals) + 1)])
    return rows


INITIAL = re.compile(r"^(?:[A-Z][a-z]?\.)+,?$")


def is_surname(tok):
    w = tok.rstrip(".,")
    return len(w) > 1 and "." not in w and w.upper() == w and any(ch.isalpha() for ch in w)


def split_authors(ref):
    toks = ref.split(" ")
    i = 0
    while i < len(toks):
        tok = toks[i]
        nxt = toks[i + 1] if i + 1 < len(toks) else ""
        if tok == "al.":
            return " ".join(toks[: i + 1]), " ".join(toks[i + 1:])
        if tok.endswith(".") and not tok.endswith(",") and nxt not in ("a", "et"):
            if is_surname(tok) or (INITIAL.match(tok) and i > 0 and toks[i - 1].endswith(",")
                                   and is_surname(toks[i - 1])):
                return " ".join(toks[: i + 1]), " ".join(toks[i + 1:])
        i += 1
    return "", ref


def fmt_authors(block):
    block = block.rstrip(".")
    etal = block.endswith(" et al")
    block = block[:-6] if etal else block
    parts = re.split(r",\s*|\s+a\s+", block)
    names, k = [], 0
    if len(parts) >= 2:  # first author: SURNAME, I.
        names.append(f"{parts[0].title()} {parts[1]}".strip())
        k = 2
    for p in parts[k:]:
        p = p.strip()
        if not p:
            continue
        m = re.match(r"^((?:[A-Z][a-z]?\.)+)\s*(.+)$", p)
        names.append(f"{m.group(2).title()} {m.group(1)}" if m else p.title())
    s = ", ".join(n.rstrip(".") + "." if re.search(r"\b[A-Z][a-z]?$", n) else n for n in names)
    s = re.sub(r"\.\.", ".", s)
    return s + (" et al." if etal else "")


def v3s_papers(path):
    keep = {"Článek": "journal", "Stať ve sborníku": "conference", "Kapitola v knize": "chapter",
            "Software splňující podmínky RIV": "software", "Článek, který teprve vyjde (je přijatý)": "journal"}
    out, seen = [], set()
    for r in read_xlsx(path):
        if len(r) < 5 or r[2] not in keep or not r[3][:2] in ("19", "20"):
            continue
        ref = r[4].strip()
        if any(s in ref.lower() for s in SKIP_PAPERS):
            continue
        auth, rest = split_authors(ref)
        if " In: " in " " + rest:
            title, venue = rest.split(" In: ", 1) if " In: " in rest else rest.split("In: ", 1)
            venue = re.sub(r"^.*?, eds?\. ", "", venue)
            venue = venue.split(". ")[0]
        else:
            title, _, venue = rest.partition(". ")
            venue = venue.split(". ")[0]
        title = title.strip().rstrip(".")
        if title.isupper():
            title = title.capitalize()
        sub = keep[r[2]]
        if sub == "software":
            title = re.sub(r"\s*\[Software.*$", "", title)
            venue = "Software (RIV)"
        doi = re.search(r"DOI (10\.\S+?)\.?(?:\s|$)", ref)
        url = re.search(r"Dostupné z: (\S+)", ref)
        key = norm(title)
        if key in seen:
            continue
        seen.add(key)
        out.append({"y": int(float(r[3])), "sub": sub, "title": title, "authors": fmt_authors(auth),
                    "venue": venue.strip(), "doi": doi.group(1) if doi else "",
                    "url": url.group(1) if url and not doi else ""})
    return out


def openalex_papers(path, known):
    out = []
    if not path:
        return out
    for w in json.load(open(path)):
        title = (w.get("title") or "").strip()
        key = norm(title)
        if (not title or w.get("type") in ("dataset", "book", "paratext", "peer-review")
                or any(s in title.lower() for s in SKIP_PAPERS)
                or any(key[:25] in k or k[:25] in key for k in known)):
            continue
        src = ((w.get("primary_location") or {}).get("source") or {}) or {}
        auth = [a["author"]["display_name"] for a in w.get("authorships", [])]
        out.append({"y": w["publication_year"], "sub": "preprint" if w.get("type") == "preprint" else "conference",
                    "title": title, "authors": ", ".join(auth[:8]) + (" et al." if len(auth) > 8 else ""),
                    "venue": src.get("display_name") or "", "doi": (w.get("doi") or "").replace("https://doi.org/", ""),
                    "url": "", "_from": "openalex"})
    return out


# ---------- theses ----------
def theses(kos_path, handles_path):
    handles = {}
    with open(handles_path, newline="") as f:
        for h in csv.DictReader(f):
            if h["Handle"] and h["Handle"] != "Not found":
                handles[norm(h["Title"])[:40]] = h["Handle"]
                handles[norm(h["Author"].split()[0]) + h["Year"]] = h["Handle"]
    out = []
    with open(kos_path, newline="") as f:
        for t in csv.DictReader(f):
            if t["role"] != "vedoucí" or t["stav"] != "obhájena":
                continue
            title = t["nazev_en"] or t["nazev"]
            year = int(t["rok_odevzdani"]) if t["rok_odevzdani"] else (2015 if t["student"] == "Petr Dušek" else 0)
            sub = {"BP": "BSc", "DP": "MSc", "DIS": "PhD"}[t["typ"]]
            surname = t["student"].split()[-1]
            h = handles.get(norm(title)[:40]) or handles.get(norm(surname) + str(year))
            out.append({"y": year, "type": "thesis", "sub": sub, "title": title.strip(),
                        "title_cs": t["nazev"].strip() if t["nazev"] != title else "",
                        "student": t["student"], "themes": classify(title, t["nazev"]),
                        "url": f"https://dspace.cvut.cz/handle/{h}" if h else ""})
    phd_years = {"Řehořek": 2019, "Bartoň": 2019, "Kuznetsov": 2023, "Motl": 2022, "Vančura": 2025}
    for t in out:
        if t["sub"] == "PhD":
            t["y"] = phd_years.get(t["student"].split()[-1], t["y"])
    for p in PHD:
        out.append({"type": "thesis", "sub": "PhD", "title_cs": "", **p})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--v3s", default=os.environ.get("TIMELINE_V3S", ""))
    ap.add_argument("--kos", default=os.environ.get("TIMELINE_KOS", ""))
    ap.add_argument("--handles", default=str(ROOT / "thesis_handles.csv"))
    ap.add_argument("--openalex", default="")
    ap.add_argument("--out", default=str(ROOT / "data/timeline.json"))
    a = ap.parse_args()

    papers = v3s_papers(a.v3s)
    for e in EXTRA_PAPERS:
        papers = [p for p in papers if norm(p["title"]) != norm(e["title"])]
        papers.append({"doi": "", "url": "", **e})
    known = {norm(p["title"]) for p in papers}
    oa = openalex_papers(a.openalex, known)
    for p in oa:
        print("openalex-only:", p["y"], p["title"][:90], "|", p["venue"][:40], file=sys.stderr)
    papers += [p for p in oa if p["y"] >= 2004]
    for p in papers:
        p["type"] = "paper"
        p["themes"] = classify(p["title"])
        p["y"] = YEAR_FIX.get(norm(p["title"])[:30], p["y"])
        for old, new in AUTHOR_FIX.items():
            p["authors"] = p["authors"].replace(old, new)
        for frag, v in VENUE_FIX.items():
            if frag in p["title"].lower():
                p["venue"] = v
        p.pop("_from", None)

    th = theses(a.kos, a.handles)
    ms = [{"y": y, "type": "milestone", "sub": k, "title": t, "text": x} for y, k, t, x in MILESTONES]
    items = sorted(ms + papers + th, key=lambda i: (-i["y"], {"milestone": 0, "paper": 1, "thesis": 2}[i["type"]]))
    data = {"generated": date.today().isoformat(), "themes": THEMES, "eras": ERAS, "items": items}
    Path(a.out).parent.mkdir(exist_ok=True)
    Path(a.out).write_text(json.dumps(data, ensure_ascii=False, indent=1))
    n = lambda f: sum(1 for i in items if f(i))
    print(f"papers {n(lambda i: i['type'] == 'paper')}, theses {n(lambda i: i['type'] == 'thesis')} "
          f"(BSc {n(lambda i: i.get('sub') == 'BSc')}, MSc {n(lambda i: i.get('sub') == 'MSc')}, "
          f"PhD {n(lambda i: i.get('sub') == 'PhD')}), milestones {len(ms)} -> {a.out}")


if __name__ == "__main__":
    main()
